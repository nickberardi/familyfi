/**
 * `pnpm spike verify`: a named list of scenarios run against a real console, so proof on
 * hardware becomes a dated record rather than a sentence in a doc.
 *
 * Every write goes through the same ownership guard the app uses
 * (`src/server/unifi/policy-ownership.ts`), with this run's own creations as the record, so
 * the run can only ever change policies it created. Each scenario deletes what it created
 * when it ends, pass or fail, and the run deletes anything still left before it returns.
 * The last step compares every other policy, and their order, with how the run found them.
 */

import assert from "node:assert/strict";
import { normalizeMac } from "../../src/server/mac";
import type { UnifiClient } from "../../src/server/unifi/client";
import { UNIFI_CLIENT_CONTRACT, rejectsWithStatus } from "../../src/server/unifi/contract-cases";
import { PolicyOwnershipError, UnifiHttpError } from "../../src/server/unifi/errors";
import { orderedPolicyIds, relativeOrderPreserved } from "../../src/server/unifi/ordering";
import { internetBlockPolicy, toPolicyUpdate } from "../../src/server/unifi/payloads";
import { withPolicyOwnership } from "../../src/server/unifi/policy-ownership";
import { toUnifiSchedule } from "../../src/server/unifi/schedule-map";
import { discoverInventory, type SpikeInventory } from "../../src/server/unifi/spike";
import { FAMILYFI_POLICY_PREFIX, type FirewallPolicy, type UnifiFirewallSchedule } from "../../src/server/unifi/types";
import {
  assertLabel,
  RECORD_FORMAT,
  redact,
  type CheckResult,
  type ScenarioRecord,
  type ScenarioResult,
  type VerifyCheck,
  type VerifyRecord,
} from "./verify-record";

/** The named list, in the order it runs. docs/testing.md shows one row per entry. */
export const VERIFY_SCENARIOS = [
  { id: "client-contract", title: "Client contract (the cases CI runs against the mock)" },
  { id: "ipv4-block-restore", title: "IPv4 MAC block and restore" },
  { id: "ipv6-block-restore", title: "IPv6 block and restore" },
  { id: "bedtime-midnight", title: "Bedtime schedule crossing midnight" },
  { id: "concurrent-macs", title: "Two concurrent MACs" },
  { id: "pause-resume-schedule", title: "Pause and resume leave the schedule intact" },
  { id: "ownership-refusal", title: "Refuses to write an administrator-created policy" },
] as const;

export type ScenarioId = (typeof VERIFY_SCENARIOS)[number]["id"];

/**
 * Ask the operator about the test device. `true` yes, `false` no, `null` not observed
 * (no one is watching: a mock run, `--no-device-checks`, or no terminal).
 */
export type Observe = (question: string) => Promise<boolean | null>;

export type VerifyOptions = {
  /** `--confirm`. Without it the run refuses before it reads anything. */
  confirm: boolean;
  /** The unguarded client for the console; the run wraps it in the ownership guard. */
  client: UnifiClient;
  mock: boolean;
  siteId?: string;
  /** Test MACs: the first is used for single-device scenarios, the second for the concurrent one. */
  macs: string[];
  console: { model: string; firmware: string };
  connection: VerifyRecord["connection"];
  familyfi: { version: string; commit: string };
  /** IANA time zone of the console's clock, for the bedtime windows. */
  timeZone: string;
  only?: ScenarioId[];
  observe?: Observe;
  now?: () => Date;
  log?: (line: string) => void;
};

export type VerifyOutcome = {
  record: VerifyRecord;
  /** Ids this run created and could not delete, for `pnpm spike cleanup`. */
  leftoverPolicyIds: string[];
  siteId: string;
  inventory: SpikeInventory;
};

export class VerifyRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerifyRefusedError";
  }
}

const MINUTES_PER_DAY = 24 * 60;
/** Room either side of now, so a window does not open or close while the operator looks. */
const WINDOW_MARGIN = 20;
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

export type BedtimeWindow = { start: string; end: string };

function hm(minutes: number): string {
  const wrapped = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

/**
 * Two bedtime windows that both cross midnight (end before start): `inside` contains the
 * current minute, `outside` does not. `outside` is null within `WINDOW_MARGIN` of midnight,
 * where no such window leaves room on both sides.
 */
export function midnightWindows(minuteOfDay: number): { inside: BedtimeWindow; outside: BedtimeWindow | null } {
  const inside =
    minuteOfDay >= MINUTES_PER_DAY / 2
      ? { start: hm(minuteOfDay - WINDOW_MARGIN), end: "01:00" }
      : { start: "23:00", end: hm(minuteOfDay + 60) };
  const outside =
    minuteOfDay - WINDOW_MARGIN >= 1 && minuteOfDay + WINDOW_MARGIN <= MINUTES_PER_DAY - 1
      ? { start: hm(minuteOfDay + WINDOW_MARGIN), end: hm(minuteOfDay - WINDOW_MARGIN) }
      : null;
  return { inside, outside };
}

export function minuteOfDay(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  return Number(parts.find((part) => part.type === "hour")?.value) * 60 + Number(parts.find((part) => part.type === "minute")?.value);
}

function bedtime(window: BedtimeWindow): UnifiFirewallSchedule {
  return toUnifiSchedule({ enabled: true, days: EVERY_DAY, start: window.start, end: window.end })!;
}

/**
 * What this run has on record: every policy it created (and the one missing id the contract
 * claims), which is all the ownership guard lets it update or delete.
 */
export class PolicyLedger {
  private readonly recorded = new Set<string>();
  private readonly live = new Set<string>();
  /** Every update or delete that got past the guard, in order. */
  readonly writes: { method: "PUT" | "DELETE"; policyId: string }[] = [];

  claim(policyId: string): void {
    this.recorded.add(policyId);
  }

  onRecord(policyId: string): boolean {
    return this.recorded.has(policyId);
  }

  liveIds(): string[] {
    return [...this.live];
  }

  /** `client`, recording what it creates and every write that reaches it. */
  track(client: UnifiClient): UnifiClient {
    const tracked: Pick<UnifiClient, "createPolicy" | "updatePolicy" | "deletePolicy"> = {
      createPolicy: async (siteId, body) => {
        const policy = await client.createPolicy(siteId, body);
        this.recorded.add(policy.id);
        this.live.add(policy.id);
        return policy;
      },
      updatePolicy: async (siteId, policyId, body) => {
        this.writes.push({ method: "PUT", policyId });
        return client.updatePolicy(siteId, policyId, body);
      },
      deletePolicy: async (siteId, policyId) => {
        this.writes.push({ method: "DELETE", policyId });
        await client.deletePolicy(siteId, policyId);
        this.live.delete(policyId);
      },
    };
    return new Proxy(client, {
      get(target, property, receiver) {
        if (property === "createPolicy" || property === "updatePolicy" || property === "deletePolicy") return tracked[property];
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  /** Delete every policy this run created that is still there. Returns the ids that would not go. */
  async removeAll(client: UnifiClient, siteId: string): Promise<string[]> {
    for (const id of this.liveIds()) {
      try {
        await client.deletePolicy(siteId, id);
      } catch (error) {
        // Already gone is what we wanted.
        if (error instanceof UnifiHttpError && error.status === 404) this.live.delete(id);
      }
    }
    return this.liveIds();
  }
}

/** Stops a scenario at its first failed check; the run then restores what it created. */
class ScenarioStop extends Error {}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redact(message.split("\n")[0]!.slice(0, 300));
}

class ScenarioRun {
  readonly checks: VerifyCheck[] = [];

  constructor(
    private readonly observeDevice: Observe,
    private readonly log: (line: string) => void,
  ) {}

  /** An API check: pass when `body` resolves, fail (and stop the scenario) when it throws. */
  async api<T>(name: string, body: () => Promise<T>, options: { stopOnFail?: boolean } = {}): Promise<T> {
    try {
      const value = await body();
      this.record({ name, kind: "api", result: "pass" });
      return value;
    } catch (error) {
      this.record({ name, kind: "api", result: "fail", detail: describeError(error) });
      if (options.stopOnFail === false) return undefined as T;
      throw new ScenarioStop();
    }
  }

  /** A device check: the operator's own observation of the test device. */
  async device(name: string, question: string): Promise<void> {
    const answer = await this.observeDevice(question);
    this.record({ name, kind: "device", result: answer === null ? "not-observed" : answer ? "pass" : "fail" });
    if (answer === false) throw new ScenarioStop();
  }

  /** A device check this run cannot make, with the reason. */
  unobserved(name: string, detail: string): void {
    this.record({ name, kind: "device", result: "not-observed", detail });
  }

  private record(check: VerifyCheck): void {
    this.checks.push(check);
    this.log(`  ${check.result.padEnd(12)} ${check.kind.padEnd(6)} ${check.name}${check.detail ? ` (${check.detail})` : ""}`);
  }
}

export function scenarioResult(checks: VerifyCheck[]): ScenarioResult {
  const results = new Set<CheckResult>(checks.map((check) => check.result));
  if (results.has("fail")) return "fail";
  if (results.size === 0) return "skipped";
  return results.has("not-observed") ? "not-observed" : "pass";
}

type Target = { mac: string; zoneId: string };

type ScenarioContext = {
  client: UnifiClient;
  siteId: string;
  externalZoneId: string;
  targets: Target[];
  inventory: SpikeInventory;
  ledger: PolicyLedger;
  minute: number;
};

type Scenario = (run: ScenarioRun, context: ScenarioContext) => Promise<string | void>;

function policyName(label: string): string {
  return `${FAMILYFI_POLICY_PREFIX}Verify ${label}`;
}

function policyMacs(policy: FirewallPolicy): string[] {
  const filter = policy.source.trafficFilter;
  return filter && "macAddressFilter" in filter ? [...(filter.macAddressFilter?.macAddresses ?? [])].map(normalizeMac).sort() : [];
}

/** One BLOCK policy per source zone for `targets`, the way reconcile writes a group. */
async function createBlocks(
  context: ScenarioContext,
  label: string,
  targets: Target[],
  schedule?: UnifiFirewallSchedule,
): Promise<FirewallPolicy[]> {
  const grouped = new Map<string, string[]>();
  for (const target of targets) grouped.set(target.zoneId, [...(grouped.get(target.zoneId) ?? []), target.mac]);
  const created: FirewallPolicy[] = [];
  for (const [sourceZoneId, macAddresses] of grouped) {
    const write = internetBlockPolicy({
      name: policyName(label),
      description: "FamilyFi verification. Deleted when the run ends.",
      sourceZoneId,
      destinationZoneId: context.externalZoneId,
      macAddresses,
      schedule,
    });
    const policy = await context.client.createPolicy(context.siteId, write);
    const read = await context.client.getPolicy(context.siteId, policy.id);
    assert.equal(read.enabled, true, "the policy reads back enabled");
    assert.equal(read.action.type, "BLOCK", "the policy reads back as BLOCK");
    assert.equal(read.destination.zoneId, context.externalZoneId, "the policy points at External");
    assert.deepEqual(policyMacs(read), [...macAddresses].sort(), "the policy reads back with the test MACs");
    if (schedule) assert.deepEqual(read.schedule, schedule, "the policy reads back with the schedule written");
    created.push(read);
  }
  return created;
}

async function setEnabled(context: ScenarioContext, policy: FirewallPolicy, enabled: boolean): Promise<FirewallPolicy> {
  const latest = await context.client.getPolicy(context.siteId, policy.id);
  await context.client.updatePolicy(context.siteId, policy.id, toPolicyUpdate(latest, { enabled }));
  const read = await context.client.getPolicy(context.siteId, policy.id);
  assert.equal(read.enabled, enabled, `the policy reads back enabled: ${enabled}`);
  assert.deepEqual(read.schedule ?? null, latest.schedule ?? null, "the schedule is unchanged");
  assert.deepEqual(policyMacs(read), policyMacs(latest), "the MACs are unchanged");
  return read;
}

async function deleteAll(context: ScenarioContext, policies: FirewallPolicy[]): Promise<void> {
  for (const policy of policies) {
    await context.client.deletePolicy(context.siteId, policy.id);
    await rejectsWithStatus(context.client.getPolicy(context.siteId, policy.id), 404, "read after delete");
  }
}

function blockRestore(ipVersion: "IPv4" | "IPv6"): Scenario {
  const curl = ipVersion === "IPv4" ? "curl -4 -m 5 https://example.com" : "curl -6 -m 5 https://example.com";
  return async (run, context) => {
    const [target] = context.targets;
    const [policy] = await run.api(`creates a BLOCK policy for the test MAC toward External`, async () => {
      const created = await createBlocks(context, ipVersion, [target!]);
      if (ipVersion === "IPv6") {
        assert.equal(created[0]!.ipProtocolScope.ipVersion, "IPV4_AND_IPV6", "the policy covers IPv6 as well as IPv4");
      }
      return created;
    });
    await run.device(
      `the test device loses ${ipVersion} internet; LAN still works`,
      `On the test device, ${ipVersion} internet fails (\`${curl}\`) and a LAN host still answers. Other devices keep internet.`,
    );
    await run.api("disables the policy (enabled: false)", () => setEnabled(context, policy!, false));
    await run.device(`the test device has ${ipVersion} internet again`, `On the test device, ${ipVersion} internet works again (\`${curl}\`).`);
    await run.api("deletes the policy", () => deleteAll(context, [policy!]));
  };
}

const SCENARIOS: Record<ScenarioId, Scenario> = {
  "client-contract": async (run, context) => {
    for (const contractCase of UNIFI_CLIENT_CONTRACT) {
      await run.api(
        contractCase.name,
        () =>
          contractCase.run({
            client: context.client,
            siteId: context.siteId,
            sourceZoneId: context.targets[0]!.zoneId,
            destinationZoneId: context.externalZoneId,
            claim: (id) => context.ledger.claim(id),
          }),
        { stopOnFail: false },
      );
    }
  },

  "ipv4-block-restore": blockRestore("IPv4"),
  "ipv6-block-restore": blockRestore("IPv6"),

  "bedtime-midnight": async (run, context) => {
    const windows = midnightWindows(context.minute);
    const inside = bedtime(windows.inside);
    const [policy] = await run.api(`creates a bedtime policy for ${windows.inside.start}–${windows.inside.end}, which crosses midnight`, () =>
      createBlocks(context, "Bedtime", [context.targets[0]!], inside),
    );
    await run.device(
      "the test device has no internet inside a window that crosses midnight",
      `Bedtime is ${windows.inside.start}–${windows.inside.end} on the console's clock, and it is inside that window now. On the test device, internet fails.`,
    );
    if (context.minute >= MINUTES_PER_DAY - 60) {
      await run.device(
        "the test device stays blocked across midnight",
        "Wait until after 00:00 on the console's clock, then check again. On the test device, internet still fails.",
      );
    } else {
      run.unobserved("the test device stays blocked across midnight", "run between 23:00 and 00:00 console time to watch the rollover");
    }
    if (windows.outside) {
      const outside = bedtime(windows.outside);
      await run.api(`moves the window to ${windows.outside.start}–${windows.outside.end}, which crosses midnight and excludes now`, async () => {
        const latest = await context.client.getPolicy(context.siteId, policy!.id);
        await context.client.updatePolicy(context.siteId, policy!.id, toPolicyUpdate(latest, { schedule: outside }));
        const read = await context.client.getPolicy(context.siteId, policy!.id);
        assert.deepEqual(read.schedule, outside, "the policy reads back with the new window");
        assert.equal(read.enabled, true, "the policy stays enabled");
      });
      await run.device(
        "the test device has internet outside the window",
        `Bedtime is now ${windows.outside.start}–${windows.outside.end}, and it is outside that window. On the test device, internet works.`,
      );
    } else {
      run.unobserved("the test device has internet outside the window", "within 20 minutes of midnight no window crossing it can exclude now");
    }
    await run.api("deletes the policy", () => deleteAll(context, [policy!]));
  },

  "concurrent-macs": async (run, context) => {
    if (context.targets.length < 2) return "needs a second test MAC in UNIFI_SPIKE_MACS";
    const [first, second] = context.targets as [Target, Target];
    const policies = await run.api("blocks both test MACs at once", () => createBlocks(context, "Concurrent", [first, second]));
    await run.device("both test devices lose internet", "On both test devices, internet fails. Other devices keep internet.");
    await run.api("releases the second MAC and keeps the first blocked", async () => {
      const holding = policies.find((policy) => policyMacs(policy).includes(second.mac))!;
      const rest = policyMacs(holding).filter((mac) => mac !== second.mac);
      if (rest.length === 0) {
        await context.client.deletePolicy(context.siteId, holding.id);
      } else {
        const latest = await context.client.getPolicy(context.siteId, holding.id);
        const source = { ...latest.source, trafficFilter: { type: "MAC_ADDRESS", macAddressFilter: { macAddresses: rest } } };
        await context.client.updatePolicy(context.siteId, holding.id, toPolicyUpdate(latest, { source }));
      }
      for (const policy of policies) {
        const read = await context.client.getPolicy(context.siteId, policy.id).catch(() => null);
        if (read) assert.ok(!policyMacs(read).includes(second.mac), "no policy still holds the second MAC");
      }
      const firstPolicy = policies.find((policy) => policyMacs(policy).includes(first.mac))!;
      const read = await context.client.getPolicy(context.siteId, firstPolicy.id);
      assert.ok(read.enabled && policyMacs(read).includes(first.mac), "the first MAC's policy is still enabled");
    });
    await run.device("the second device has internet again; the first is still blocked", "The second test device has internet again. The first still has none.");
    const remaining: FirewallPolicy[] = [];
    for (const policy of policies) {
      const read = await context.client.getPolicy(context.siteId, policy.id).catch(() => null);
      if (read) remaining.push(read);
    }
    await run.api("disables the first MAC's policy", async () => {
      for (const policy of remaining) await setEnabled(context, policy, false);
    });
    await run.device("the first device has internet again", "The first test device has internet again.");
    await run.api("deletes the policies", () => deleteAll(context, remaining));
  },

  "pause-resume-schedule": async (run, context) => {
    const window = midnightWindows(context.minute).inside;
    const schedule = bedtime(window);
    const [policy] = await run.api(`creates a bedtime policy for ${window.start}–${window.end}, inside the window now`, () =>
      createBlocks(context, "Pause", [context.targets[0]!], schedule),
    );
    await run.device("the test device has no internet at bedtime", "Bedtime is on now. On the test device, internet fails.");
    await run.api("pauses (enabled: false) and keeps the schedule", async () => {
      const read = await setEnabled(context, policy!, false);
      assert.deepEqual(read.schedule, schedule, "the paused policy keeps its bedtime");
    });
    await run.device("the test device has internet while paused", "Paused. On the test device, internet works although bedtime is on.");
    await run.api("resumes (enabled: true) with the schedule intact", async () => {
      const read = await setEnabled(context, policy!, true);
      assert.deepEqual(read.schedule, schedule, "the resumed policy keeps its bedtime");
    });
    await run.device("the test device is blocked again after resume", "Resumed. On the test device, internet fails again.");
    await run.api("deletes the policy", () => deleteAll(context, [policy!]));
  },

  "ownership-refusal": async (run, context) => {
    const admin = context.inventory.policies
      .filter((policy) => policy.metadata.origin === "USER_DEFINED" && !context.ledger.onRecord(policy.id))
      .sort((a, b) => a.index - b.index)[0];
    if (!admin) return "the console has no administrator-created policy to refuse";
    const before = await context.client.getPolicy(context.siteId, admin.id);
    const sent = () => context.ledger.writes.filter((write) => write.policyId === admin.id).length;
    await run.api("refuses to update an administrator's policy, sending nothing", async () => {
      await assert.rejects(context.client.updatePolicy(context.siteId, admin.id, toPolicyUpdate(before, { enabled: !before.enabled })), PolicyOwnershipError);
      assert.equal(sent(), 0, "no update reached the console");
    });
    await run.api("refuses to delete an administrator's policy, sending nothing", async () => {
      await assert.rejects(context.client.deletePolicy(context.siteId, admin.id), PolicyOwnershipError);
      assert.equal(sent(), 0, "no delete reached the console");
    });
    await run.api("leaves the administrator's policy as it was", async () => {
      assert.deepEqual(await context.client.getPolicy(context.siteId, admin.id), before, "the policy reads back unchanged");
    });
  },
};

function resolveTargets(inventory: SpikeInventory, macs: string[]): Target[] {
  const targets: Target[] = [];
  for (const mac of macs) {
    const mapping = inventory.mappings.find((item) => item.macAddress === mac);
    if (!mapping) throw new VerifyRefusedError(`Test MAC ${redact(mac)} is not among the console's connected clients.`);
    if (!mapping.sourceZoneId) throw new VerifyRefusedError(`Test MAC ${redact(mac)} could not be mapped to a firewall zone.`);
    targets.push({ mac, zoneId: mapping.sourceZoneId });
  }
  return targets;
}

/** `index` is the console's position counter; it may move as other policies come and go. */
function withoutIndex(policy: FirewallPolicy): Partial<FirewallPolicy> {
  const rest: Partial<FirewallPolicy> = { ...policy };
  delete rest.index;
  return rest;
}

/** Run the named scenarios in order, restore everything, and return the record. */
export async function runVerify(options: VerifyOptions): Promise<VerifyOutcome> {
  if (!options.confirm) {
    throw new VerifyRefusedError(
      "Refusing verify without --confirm. It creates, changes and deletes firewall policies on the console, and blocks the test devices' internet.",
    );
  }
  const consoleModel = options.mock ? "UNIFI_MOCK" : assertLabel("--console-model", options.console.model);
  const consoleFirmware = options.mock ? "mock" : assertLabel("--console-firmware", options.console.firmware);
  const macs = [...new Set(options.macs.map(normalizeMac))];
  if (macs.length === 0) throw new VerifyRefusedError("Set UNIFI_SPIKE_MACS or pass --mac <address> for at least one test device.");
  const log = options.log ?? (() => undefined);
  const observe = options.observe ?? (async () => null);
  const now = options.now ?? (() => new Date());
  const selected = VERIFY_SCENARIOS.filter((scenario) => !options.only?.length || options.only.includes(scenario.id));

  const inventory = await discoverInventory(options.client, options.siteId);
  const siteId = inventory.site.id;
  const targets = resolveTargets(inventory, macs);
  const snapshot = structuredClone(inventory.policies);
  const ledger = new PolicyLedger();
  const client = withPolicyOwnership(ledger.track(options.client), { connectionIdentity: "spike-verify", siteId }, async (_scope, site, id) =>
    site === siteId && ledger.onRecord(id),
  );

  const scenarios: ScenarioRecord[] = [];
  let leftoverPolicyIds: string[] = [];
  try {
    for (const definition of selected) {
      log(`\n${definition.title}`);
      const run = new ScenarioRun(observe, log);
      const context: ScenarioContext = {
        client,
        siteId,
        externalZoneId: inventory.externalZone.id,
        targets,
        inventory,
        ledger,
        minute: minuteOfDay(now(), options.timeZone),
      };
      let note: string | undefined;
      try {
        note = (await SCENARIOS[definition.id](run, context)) ?? undefined;
      } catch (error) {
        if (!(error instanceof ScenarioStop)) {
          run.checks.push({ name: "runs without an unexpected error", kind: "api", result: "fail", detail: describeError(error) });
        }
      } finally {
        // Each scenario starts from the console as the run found it.
        await ledger.removeAll(client, siteId);
      }
      const result = note ? "skipped" : scenarioResult(run.checks);
      if (note) log(`  skipped: ${note}`);
      scenarios.push({ id: definition.id, title: definition.title, result, checks: run.checks, ...(note ? { note } : {}) });
    }
  } finally {
    leftoverPolicyIds = await ledger.removeAll(client, siteId);
  }

  const restore: VerifyRecord["restore"] = {
    result: "fail",
    leftoverPolicies: leftoverPolicyIds.length,
    unexpectedPolicies: 0,
    adminPoliciesUnchanged: false,
    adminOrderPreserved: false,
  };
  try {
    const after = await discoverInventory(options.client, siteId);
    const afterById = new Map(after.policies.map((policy) => [policy.id, policy]));
    const beforeIds = new Set(snapshot.map((policy) => policy.id));
    restore.adminPoliciesUnchanged = snapshot.every((policy) => {
      const now = afterById.get(policy.id);
      try {
        assert.deepEqual(now && withoutIndex(now), withoutIndex(policy));
        return true;
      } catch {
        return false;
      }
    });
    restore.adminOrderPreserved = relativeOrderPreserved(orderedPolicyIds(inventory.ordering), orderedPolicyIds(after.ordering));
    restore.unexpectedPolicies = after.policies.filter((policy) => !beforeIds.has(policy.id) && !ledger.liveIds().includes(policy.id)).length;
  } catch (error) {
    restore.detail = describeError(error);
  }
  if (
    restore.leftoverPolicies === 0 &&
    restore.unexpectedPolicies === 0 &&
    restore.adminPoliciesUnchanged &&
    restore.adminOrderPreserved &&
    !restore.detail
  ) {
    restore.result = "pass";
  }

  const record: VerifyRecord = {
    format: RECORD_FORMAT,
    date: localDate(now(), options.timeZone),
    mock: options.mock,
    console: { model: consoleModel, firmware: consoleFirmware, network: inventory.applicationVersion },
    connection: options.connection,
    familyfi: options.familyfi,
    scenarios,
    restore,
  };
  return { record, leftoverPolicyIds, siteId, inventory };
}

function localDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
