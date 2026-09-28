/**
 * Randomised reconciler tests. Hand-written scenarios check the cases someone thought of;
 * these generate households, gateways and sequences of changes, reconcile after every
 * step, and check the rules FamilyFi promises (AGENTS.md, docs/architecture.md) against
 * the resulting gateway. The expected state is worked out here from the database, not by
 * calling the planner, so a planner bug cannot hide behind its own answer.
 *
 * On failure fast-check prints the seed and the shrunk sequence; pass them to `fc.assert`
 * as `{ seed, path }` to replay exactly that case.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { AssignmentState, FamilyRole, GroupKind, RuleKind, RuleMode } from "@prisma/client";
import { prisma } from "@/server/db";
import { runReconcileOnce, setReconcileClientForTests } from "@/server/reconciliation";
import { createFixtureUnifiClient } from "@/server/unifi/dev-mock";
import { toUnifiSchedule } from "@/server/unifi/schedule-map";
import type { FirewallPolicy } from "@/server/unifi/types";
import { INTERNAL_NETWORK, IOT_NETWORK, configureConnectedHousehold, resetDatabase } from "../helpers/db";
import { policyMacs } from "../helpers/unifi-world";

const MACS = [1, 2, 3, 4, 5].map((n) => `02:00:00:00:01:0${n}`);
const GROUP_COUNT = 3;
/** Where a client can sit: a subnet the gateway maps to a network, or one it does not know. */
const PLACES = {
  internal: { ip: (n: number) => `192.0.2.${100 + n}` },
  iot: { ip: (n: number) => `198.51.100.${100 + n}` },
  elsewhere: { ip: (n: number) => `203.0.113.${100 + n}` },
} as const;
type Place = keyof typeof PLACES | "absent";

type GroupSpec = {
  protected: boolean;
  paused: boolean;
  allowed: boolean;
};

type WindowSpec = { name: string; days: number[]; start: string; end: string };

type RuleSpec = {
  kind: "internet" | "category";
  groups: number[];
  always: boolean;
  windows: WindowSpec[];
  enabled: boolean;
};

type World = {
  manageAll: boolean;
  managed: string[];
  quarantineEnforced: boolean;
  groups: GroupSpec[];
  rules: RuleSpec[];
  places: Place[];
  /** Each device's group once discovered, or null to leave it in quarantine. */
  assignments: (number | null)[];
  lookalikes: string[];
};

type Step =
  | { kind: "assign"; mac: number; group: number | null }
  | { kind: "protect"; group: number; value: boolean }
  | { kind: "pause"; group: number }
  | { kind: "resume"; group: number }
  | { kind: "allow"; group: number }
  | { kind: "disallow"; group: number }
  | { kind: "toggleRule"; pick: number }
  | { kind: "renameRule"; pick: number }
  | { kind: "move"; mac: number; place: Place }
  | { kind: "deleteGroup"; group: number }
  | { kind: "deleteDevice"; mac: number }
  | { kind: "quarantine"; enforced: boolean }
  /** Someone deletes one of FamilyFi's policies in the UniFi console. */
  | { kind: "consoleDelete"; pick: number }
  /** A delete elsewhere dropped a record but its UniFi delete failed: the policy is orphaned. */
  | { kind: "orphan"; pick: number };

const place = fc.constantFrom<Place>("internal", "iot", "elsewhere", "absent");
const groupIndex = fc.integer({ min: 0, max: GROUP_COUNT - 1 });
const macIndex = fc.integer({ min: 0, max: MACS.length - 1 });

const world: fc.Arbitrary<World> = fc.record({
  manageAll: fc.boolean(),
  managed: fc.subarray([INTERNAL_NETWORK, IOT_NETWORK]),
  quarantineEnforced: fc.boolean(),
  groups: fc.array(
    fc.record({ protected: fc.boolean(), paused: fc.boolean(), allowed: fc.boolean() }),
    { minLength: GROUP_COUNT, maxLength: GROUP_COUNT },
  ),
  rules: fc.array(
    fc.record({
      kind: fc.constantFrom<RuleSpec["kind"]>("internet", "category"),
      groups: fc.subarray([0, 1, 2]),
      always: fc.boolean(),
      windows: fc.array(
        fc.record({
          name: fc.constantFrom("", "Homework", "Bedtime"),
          days: fc.subarray([0, 1, 2, 3, 4, 5, 6], { minLength: 1 }),
          start: fc.constantFrom("21:00", "21:30", "13:00"),
          end: fc.constantFrom("06:45", "07:00", "15:00"),
        }),
        { minLength: 1, maxLength: 2 },
      ),
      enabled: fc.boolean(),
    }),
    { maxLength: 3 },
  ),
  places: fc.array(place, { minLength: MACS.length, maxLength: MACS.length }),
  assignments: fc.array(fc.option(groupIndex, { nil: null, freq: 3 }), { minLength: MACS.length, maxLength: MACS.length }),
  // Administrator policies, some named like ours: the name must never make them ours.
  lookalikes: fc.subarray(["Allow printer", "FamilyFi Kids bedtime", "FamilyFi Quarantine Internal Devices"]),
});

const step: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant("assign" as const), mac: macIndex, group: fc.option(groupIndex, { nil: null }) }),
  fc.record({ kind: fc.constant("protect" as const), group: groupIndex, value: fc.boolean() }),
  fc.record({ kind: fc.constant("pause" as const), group: groupIndex }),
  fc.record({ kind: fc.constant("resume" as const), group: groupIndex }),
  fc.record({ kind: fc.constant("allow" as const), group: groupIndex }),
  fc.record({ kind: fc.constant("disallow" as const), group: groupIndex }),
  fc.record({ kind: fc.constant("toggleRule" as const), pick: fc.nat() }),
  fc.record({ kind: fc.constant("renameRule" as const), pick: fc.nat() }),
  fc.record({ kind: fc.constant("move" as const), mac: macIndex, place }),
  fc.record({ kind: fc.constant("deleteGroup" as const), group: groupIndex }),
  fc.record({ kind: fc.constant("deleteDevice" as const), mac: macIndex }),
  fc.record({ kind: fc.constant("quarantine" as const), enforced: fc.boolean() }),
  fc.record({ kind: fc.constant("consoleDelete" as const), pick: fc.nat() }),
  fc.record({ kind: fc.constant("orphan" as const), pick: fc.nat() }),
);

type Client = ReturnType<typeof createFixtureUnifiClient>;
const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const PAUSED_UNTIL = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

function placeClient(client: Client, mac: number, where: Place) {
  const id = `44444444-4444-4444-8444-5555555555${String(mac).padStart(2, "0")}`;
  client.state.clients = client.state.clients.filter((row) => row.id !== id);
  if (where === "absent") return;
  client.state.clients.push({ id, name: `device ${mac}`, type: "WIRELESS", ipAddress: PLACES[where].ip(mac), macAddress: MACS[mac] });
}

async function build(spec: World): Promise<{ client: Client; groupIds: string[]; admin: Map<string, string> }> {
  await resetDatabase();
  await configureConnectedHousehold({ manageAllNetworks: spec.manageAll, managedNetworkIds: spec.managed });
  await prisma().household.update({ where: { id: "default" }, data: { quarantineEnforced: spec.quarantineEnforced } });
  const client = createFixtureUnifiClient();
  client.state.clients = [];
  spec.places.forEach((where, mac) => placeClient(client, mac, where));
  const template = client.state.policies[0]!;
  spec.lookalikes.forEach((name, n) => {
    client.state.policies.push({ ...template, id: `77777777-7777-4777-8777-77777777777${n}`, name, index: 20 + n });
  });
  // Byte-for-byte snapshot of every policy an administrator made.
  const admin = new Map(client.state.policies.map((policy) => [policy.id, JSON.stringify(policy)]));

  const groupIds: string[] = [];
  for (const [n, group] of spec.groups.entries()) {
    const row = await prisma().group.create({
      data: {
        kind: GroupKind.family,
        familyRole: FamilyRole.child,
        name: `Group ${n}`,
        protected: group.protected,
        suspensionActive: group.paused,
        suspensionUntil: group.paused ? PAUSED_UNTIL() : null,
        allowActive: group.allowed,
        allowUntil: group.allowed ? PAUSED_UNTIL() : null,
      },
    });
    groupIds.push(row.id);
  }
  for (const [n, rule] of spec.rules.entries()) {
    // An internet rule always has windows: all-day blocking is a pause.
    const always = rule.kind === "category" && rule.always;
    await prisma().rule.create({
      data: {
        name: `Rule ${n}`,
        kind: rule.kind === "internet" ? RuleKind.internet : RuleKind.category,
        targetIds: rule.kind === "internet" ? [] : [4],
        enabled: rule.enabled,
        mode: always ? RuleMode.always : RuleMode.scheduled,
        groups: { create: [...new Set(rule.groups)].map((index) => ({ groupId: groupIds[index]! })) },
        windows: { create: always ? [] : rule.windows.map((window, position) => ({ ...window, position })) },
      },
    });
  }
  setReconcileClientForTests(client);
  return { client, groupIds, admin };
}

async function apply(change: Step, client: Client, groupIds: string[]) {
  const db = prisma();
  const groupId = "group" in change && change.group !== null ? groupIds[change.group] : null;
  switch (change.kind) {
    case "assign": {
      const device = await db.device.findUnique({ where: { mac: MACS[change.mac] } });
      const target = groupId ? await db.group.findUnique({ where: { id: groupId } }) : null;
      if (!device || (groupId && !target)) return;
      await db.device.update({
        where: { mac: MACS[change.mac] },
        data: target
          ? { groupId: target.id, assignment: AssignmentState.assigned }
          : { groupId: null, assignment: AssignmentState.quarantined },
      });
      return;
    }
    case "protect":
      await db.group.updateMany({ where: { id: groupId! }, data: { protected: change.value } });
      return;
    case "pause":
      await db.group.updateMany({ where: { id: groupId! }, data: { suspensionActive: true, suspensionUntil: PAUSED_UNTIL() } });
      return;
    case "resume":
      await db.group.updateMany({ where: { id: groupId! }, data: { suspensionActive: false, suspensionUntil: null } });
      return;
    case "allow":
      await db.group.updateMany({ where: { id: groupId! }, data: { allowActive: true, allowUntil: PAUSED_UNTIL() } });
      return;
    case "disallow":
      await db.group.updateMany({ where: { id: groupId! }, data: { allowActive: false, allowUntil: null } });
      return;
    case "toggleRule":
    case "renameRule": {
      const rules = await db.rule.findMany({ orderBy: { id: "asc" } });
      if (!rules.length) return;
      const rule = rules[change.pick % rules.length]!;
      await db.rule.update({
        where: { id: rule.id },
        data: change.kind === "toggleRule" ? { enabled: !rule.enabled } : { name: `${rule.name} renamed` },
      });
      return;
    }
    case "move":
      placeClient(client, change.mac, change.place);
      return;
    case "deleteGroup":
      await db.group.deleteMany({ where: { id: groupId! } });
      return;
    case "deleteDevice":
      await db.device.deleteMany({ where: { mac: MACS[change.mac] } });
      return;
    case "quarantine":
      await db.household.update({ where: { id: "default" }, data: { quarantineEnforced: change.enforced } });
      return;
    case "consoleDelete":
    case "orphan": {
      const records = [
        ...(await db.appPolicy.findMany({ where: { unifiPolicyId: { not: null } }, orderBy: { id: "asc" } })).map((row) => ({ table: "app" as const, row })),
        ...(await db.rulePolicy.findMany({ where: { unifiPolicyId: { not: null } }, orderBy: { id: "asc" } })).map((row) => ({ table: "rule" as const, row })),
      ];
      if (!records.length) return;
      const record = records[change.pick % records.length]!;
      if (change.kind === "consoleDelete") {
        client.state.policies = client.state.policies.filter((policy) => policy.id !== record.row.unifiPolicyId);
      } else if (record.table === "app") {
        await db.appPolicy.delete({ where: { id: record.row.id } });
      } else {
        await db.rulePolicy.delete({ where: { id: record.row.id } });
      }
      return;
    }
  }
}

/** Every rule the gateway must satisfy after a reconcile, checked from scratch. */
async function checkGateway(client: Client, admin: Map<string, string>) {
  const db = prisma();
  const [household, groups, devices, records, rules, ruleRecords] = await Promise.all([
    db.household.findUniqueOrThrow({ where: { id: "default" } }),
    db.group.findMany(),
    db.device.findMany(),
    db.appPolicy.findMany(),
    db.rule.findMany({ include: { groups: true, windows: true } }),
    db.rulePolicy.findMany(),
  ]);
  const now = new Date();

  // Administrator policies: untouched, byte for byte, whatever they are named.
  for (const [id, snapshot] of admin) {
    const current = client.state.policies.find((policy) => policy.id === id);
    expect(current && JSON.stringify(current), `administrator policy ${id}`).toBe(snapshot);
  }
  for (const call of client.calls.filter((call) => WRITES.has(call.method))) {
    expect(call.path, "ordering is never written").not.toMatch(/ordering/);
    expect([...admin.keys()].some((id) => call.path.includes(id)), `${call.method} ${call.path}`).toBe(false);
  }

  // Ownership: every policy FamilyFi added is on record, and every record is on the gateway.
  const byId = new Map(client.state.policies.map((policy) => [policy.id, policy]));
  const recorded = new Map(records.filter((row) => row.unifiPolicyId).map((row) => [row.unifiPolicyId!, row]));
  const ruleRecorded = new Map(ruleRecords.filter((row) => row.unifiPolicyId).map((row) => [row.unifiPolicyId!, row]));
  for (const policy of client.state.policies) {
    if (!admin.has(policy.id)) expect(recorded.has(policy.id) || ruleRecorded.has(policy.id), `unrecorded policy ${policy.name}`).toBe(true);
  }
  for (const id of [...recorded.keys(), ...ruleRecorded.keys()]) expect(byId.has(id), `record ${id} points at no policy`).toBe(true);
  const owners = [...recorded.values()].map((row) => `${row.ownerScope}:${row.groupId}|${row.zoneId}`);
  expect(new Set(owners).size, "one policy per owner and zone").toBe(owners.length);
  const ruleOwners = [...ruleRecorded.values()].map((row) => `${row.ruleId}:${row.windowKey}|${row.zoneId}`);
  expect(new Set(ruleOwners).size, "one policy per rule window and zone").toBe(ruleOwners.length);

  const ours = [...recorded.entries()].map(([id, row]) => ({ row, policy: byId.get(id)! }));
  const ourRules = [...ruleRecorded.entries()].map(([id, row]) => ({ row, policy: byId.get(id)! }));
  const inScope = (networkId: string | null) =>
    household.unifiManageAllNetworks || (networkId !== null && household.unifiManagedNetworkIds.includes(networkId));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const active = (on: boolean, until: Date | null) => on && (!until || until > now);
  const paused = (group: (typeof groups)[number]) => active(group.suspensionActive, group.suspensionUntil);
  const allowed = (group: (typeof groups)[number]) => active(group.allowActive, group.allowUntil);

  for (const device of devices) {
    // Off a managed network, or in no known zone: its group's policies are kept on purpose.
    if (!inScope(device.networkId) || !device.zoneId) continue;
    const group = device.assignment === AssignmentState.assigned && device.groupId ? groupById.get(device.groupId) : undefined;
    const holding = ours.filter(({ policy }) => policyMacs(policy).includes(device.mac));
    const holdingRules = ourRules.filter(({ policy }) => policyMacs(policy).includes(device.mac));
    if (group?.protected) {
      expect([...holding, ...holdingRules].map(({ policy }) => policy.name), `${device.mac} in protected ${group.name}`).toEqual([]);
      continue;
    }
    if (!group) {
      // Quarantine: its zone's quarantine policy, and no rule.
      expect(holding.map(({ row }) => [row.ownerScope, row.zoneId]), `${device.mac} quarantine`).toEqual([["quarantine", device.zoneId]]);
      expect(holdingRules, `${device.mac} quarantined but in a rule`).toEqual([]);
      continue;
    }
    // Its group's pause policy while paused, and never another group's.
    expect(holding.map(({ row }) => [row.ownerScope, row.groupId, row.zoneId]), `${device.mac} pause`).toEqual(
      paused(group) ? [["group", group.id, device.zoneId]] : [],
    );
    // One policy per window of every rule covering its group, in its zone. An allowance
    // takes it out of internet rules, unless no one is left and the policy is disabled.
    for (const rule of rules.filter((rule) => rule.groups.some((link) => link.groupId === group.id))) {
      const keys = rule.mode === RuleMode.always ? ["always"] : rule.windows.map((window) => window.id);
      for (const key of keys) {
        const found = ourRules.filter(({ row }) => row.ruleId === rule.id && row.windowKey === key && row.zoneId === device.zoneId);
        expect(found.length, `${rule.name} ${key} policy in ${device.zoneId}`).toBe(1);
        const { policy } = found[0]!;
        const inside = policyMacs(policy).includes(device.mac);
        if (rule.kind === RuleKind.internet && allowed(group)) {
          expect(!inside || !policy.enabled, `${device.mac} allowed but held by ${policy.name}`).toBe(true);
        } else {
          expect(inside, `${device.mac} missing from ${policy.name}`).toBe(true);
          expect(policy.enabled, `${policy.name} enabled`).toBe(rule.enabled);
        }
      }
    }
  }

  // Enforcement: a pause is an unscheduled block, quarantine follows the household
  // switch, and a rule's windows are UniFi schedules named after the rule.
  for (const { row, policy } of ours) {
    if (row.ownerScope === "quarantine") {
      expect(policy.enabled, `quarantine ${policy.name}`).toBe(household.quarantineEnforced);
      continue;
    }
    expect(policy.enabled, `pause ${policy.name}`).toBe(true);
    expect((policy as FirewallPolicy).schedule ?? undefined, `pause ${policy.name} schedule`).toBeUndefined();
  }
  for (const { row, policy } of ourRules) {
    const rule = rules.find((item) => item.id === row.ruleId);
    if (!rule) continue;
    if (!rule.enabled) expect(policy.enabled, `${policy.name} off`).toBe(false);
    expect(policy.name.startsWith(`FamilyFi ${rule.name}`), policy.name).toBe(true);
    const window = rule.windows.find((item) => item.id === row.windowKey);
    const schedule = window ? toUnifiSchedule({ enabled: true, days: window.days, start: window.start, end: window.end }) : undefined;
    expect((policy as FirewallPolicy).schedule ?? undefined, `${policy.name} schedule`).toEqual(schedule);
  }
}

describe("reconciliation properties", () => {
  it(
    "keeps the gateway right after every change, and settles in one pass",
    async () => {
      await fc.assert(
        fc.asyncProperty(world, fc.array(step, { maxLength: 6 }), async (spec, changes) => {
          const { client, groupIds, admin } = await build(spec);
          try {
            expect(await runReconcileOnce()).toBe(true);
            await checkGateway(client, admin);
            // Discovery has quarantined every managed device; now the household sorts them.
            for (const [mac, group] of spec.assignments.entries()) {
              await apply({ kind: "assign", mac, group }, client, groupIds);
            }
            expect(await runReconcileOnce()).toBe(true);
            await checkGateway(client, admin);
            for (const change of changes) {
              await apply(change, client, groupIds);
              expect(await runReconcileOnce()).toBe(true);
              await checkGateway(client, admin);
            }
            // Nothing changed since the last pass, so the next one writes nothing.
            client.calls.length = 0;
            expect(await runReconcileOnce()).toBe(true);
            expect(client.calls.filter((call) => WRITES.has(call.method))).toEqual([]);
          } finally {
            setReconcileClientForTests(undefined);
          }
        }),
        { numRuns: 40 },
      );
    },
    180_000,
  );
});
