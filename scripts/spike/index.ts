#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { APP_VERSION } from "../../src/lib/version";
import { unifiMockEnabled } from "../../src/server/env";
import { HttpUnifiClient, type UnifiClient } from "../../src/server/unifi/client";
import { createFixtureUnifiClient } from "../../src/server/unifi/dev-mock";
import { UnifiConfigError } from "../../src/server/unifi/errors";
import { orderedPolicyIds, relativeOrderPreserved } from "../../src/server/unifi/ordering";
import { sanitizeUnifiValue } from "../../src/server/unifi/sanitize";
import {
  applyInternetBlocks,
  deletePolicies,
  discoverInventory,
  ownedSpikePolicies,
  setPoliciesEnabled,
} from "../../src/server/unifi/spike";
import { UNIFI_API_VERSION } from "../../src/server/unifi/types";
import { normalizeMac } from "../../src/server/mac";
import { clearSpikeState, readSpikeState, writeSpikeState } from "./state";
import { runVerify, VERIFY_SCENARIOS, VerifyRefusedError, type Observe, type ScenarioId } from "./verify";
import { loadRecords, renderStatusTable, replaceStatusTable, VERIFICATION_DIR, writeRecord } from "./verify-record";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/** Where a mock run's record goes: ignored by git, because a mock proves nothing. */
const MOCK_RECORD_DIR = "scripts/spike/.live-verify";

function help(): string {
  return `FamilyFi UniFi spike (official Network Integration API ${UNIFI_API_VERSION})

This CLI talks to UniFi. It does not store keys in PostgreSQL.
API success is not client proof. After apply/disable, check internet and LAN
on the test device itself (see docs/spike/OPERATOR.md).

Credentials (CLI-only):
  UNIFI_API_KEY                 operator-created UniFi key
  UNIFI_BASE_URL                https://<console-ip>/proxy/network/integration
  or UNIFI_CONSOLE_ID           cloud connector console id
  UNIFI_SITE_ID                 required when the console has more than one site
  UNIFI_SPIKE_MACS              comma-separated test MACs
  UNIFI_SPIKE_INSTALL_ID        default local (legacy spike name matching)
  UNIFI_TLS_INSECURE=1          local consoles with a private CA
  UNIFI_SPIKE_CONFIRM=1         required for apply and cleanup
  UNIFI_MOCK=1                  verify only: run against the local mock (never a record)

Commands:
  discover    list sites, zones, networks, clients (local stdout)
  snapshot    print policy names and ordering ids
  apply       create BLOCK policies for UNIFI_SPIKE_MACS toward External
  disable     PUT enabled=false on spike-created policies
  enable      PUT enabled=true on spike-created policies
  cleanup     delete spike-created policies and compare admin order
  status      show recorded spike policy ids
  verify      run the verification scenarios and write a dated record
              (docs/spike/OPERATOR.md, "Verification run"). Flags:
                --confirm                 required: it blocks the test devices' internet
                --console-model <name>    for example "UCG Max"
                --console-firmware <ver>  UniFi OS version, from the console's settings
                --mac <address>           test device (repeatable; or UNIFI_SPIKE_MACS)
                --timezone <IANA zone>    the console's clock (default: this machine's)
                --only <id,id>            run some scenarios (${VERIFY_SCENARIOS.map((scenario) => scenario.id).join(", ")})
                --no-device-checks        API checks only; enforcement is recorded as not observed
                --out <dir>               where the record goes (default ${VERIFICATION_DIR})

Never commit keys, .live-state.json, or unsanitized household dumps.
API success is not client proof; confirm internet and LAN on the test device.
`;
}

function envFlag(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function requireConfirm(command: string): void {
  if (envFlag("UNIFI_SPIKE_CONFIRM") || process.argv.includes("--yes")) return;
  console.error(`Refusing ${command} without UNIFI_SPIKE_CONFIRM=1 (or --yes).`);
  process.exit(2);
}

function parseMacs(): string[] {
  const fromEnv = process.env.UNIFI_SPIKE_MACS ?? "";
  const fromArgs = flagValues("--mac");
  const raw = [fromEnv, ...fromArgs].join(",");
  const macs = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(normalizeMac);
  return [...new Set(macs)];
}

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function flagValues(name: string): string[] {
  return process.argv.flatMap((arg, index) => (arg === name && process.argv[index + 1] ? [process.argv[index + 1]!] : []));
}

function createClient(): HttpUnifiClient {
  const apiKey = process.env.UNIFI_API_KEY?.trim();
  if (!apiKey) {
    throw new UnifiConfigError("Set UNIFI_API_KEY and either UNIFI_BASE_URL or UNIFI_CONSOLE_ID.");
  }
  if (envFlag("UNIFI_TLS_INSECURE")) {
    // Spike process only. Local consoles often present a private CA.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
  return new HttpUnifiClient({
    apiKey,
    baseUrl: process.env.UNIFI_BASE_URL,
    consoleId: process.env.UNIFI_CONSOLE_ID,
  });
}

function printJson(value: unknown): void {
  const payload = envFlag("UNIFI_SPIKE_SANITIZE") ? sanitizeUnifiValue(value) : value;
  if (!envFlag("UNIFI_SPIKE_SANITIZE")) {
    console.error("Do not commit this output. It may contain household MACs, names, and IPs.");
  }
  console.log(JSON.stringify(payload, null, 2));
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2).filter((arg) => arg !== "--");
  const command = argv[0] ?? "help";
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(help());
    const key = process.env.UNIFI_API_KEY?.trim();
    const target = process.env.UNIFI_BASE_URL || process.env.UNIFI_CONSOLE_ID;
    if (!key || !target) return 2;
    return 0;
  }

  if (command === "verify") return verify();

  const client = createClient();
  const installId = process.env.UNIFI_SPIKE_INSTALL_ID?.trim() || "local";
  const siteId = process.env.UNIFI_SITE_ID?.trim() || flagValue("--site");

  if (command === "discover") {
    const inventory = await discoverInventory(client, siteId);
    printJson({
      api: UNIFI_API_VERSION,
      applicationVersion: inventory.applicationVersion,
      connection: process.env.UNIFI_CONSOLE_ID ? "cloud" : "local",
      site: inventory.site,
      externalZone: { id: inventory.externalZone.id, name: inventory.externalZone.name },
      zones: inventory.zones.map((zone) => ({ id: zone.id, name: zone.name, networkIds: zone.networkIds })),
      networks: inventory.networks.map((network) => ({
        id: network.id,
        name: network.name,
        vlanId: network.vlanId,
        zoneId: network.zoneId,
        prefixLength: network.ipv4Configuration?.prefixLength,
      })),
      clients: inventory.clients.map((item, index) => ({
        id: item.id,
        type: item.type,
        mapping: inventory.mappings[index],
      })),
      mappingNote:
        "Official client overview/details do not include networkId. Mapping uses network references and IPv4 subnets from network details, then zone.networkIds / network.zoneId.",
    });
    return 0;
  }

  if (command === "snapshot") {
    const inventory = await discoverInventory(client, siteId);
    printJson({
      applicationVersion: inventory.applicationVersion,
      policyCount: inventory.policies.length,
      policies: inventory.policies.map((policy) => ({
        id: policy.id,
        name: policy.name,
        enabled: policy.enabled,
        action: policy.action,
        origin: policy.metadata.origin,
      })),
      ordering: inventory.ordering,
    });
    return 0;
  }

  if (command === "status") {
    console.log(JSON.stringify(readSpikeState(), null, 2));
    return 0;
  }

  if (command === "apply") {
    requireConfirm("apply");
    const macs = parseMacs();
    if (macs.length === 0) {
      console.error("Set UNIFI_SPIKE_MACS or pass --mac <address>.");
      return 2;
    }
    const inventory = await discoverInventory(client, siteId);
    const result = await applyInternetBlocks(client, inventory, macs);
    writeSpikeState({
      siteId: inventory.site.id,
      installId,
      macs,
      policyIds: result.created.map((policy) => policy.id),
      orderingBefore: inventory.ordering,
      createdAt: new Date().toISOString(),
    });
    printJson({
      created: result.created.map((policy) => ({ id: policy.id, name: policy.name, enabled: policy.enabled })),
      adminOrderPreserved: result.adminOrderPreserved,
      next: [
        "On each test device: confirm internet is down (new + already-open sessions) and LAN still works.",
        "Unrelated devices must keep internet.",
        "Then: UNIFI_SPIKE_CONFIRM=1 pnpm spike -- disable",
      ],
    });
    return result.adminOrderPreserved ? 0 : 1;
  }

  if (command === "disable" || command === "enable") {
    const state = readSpikeState();
    if (!state) {
      console.error("No spike state file. Run apply first.");
      return 2;
    }
    const policies = [];
    for (const id of state.policyIds) {
      policies.push(await client.getPolicy(state.siteId, id));
    }
    const updated = await setPoliciesEnabled(client, state.siteId, policies, command === "enable");
    printJson({
      updated: updated.map((policy) => ({ id: policy.id, name: policy.name, enabled: policy.enabled })),
      next:
        command === "disable"
          ? "On each test device: confirm internet is restored according to admin rules. Then cleanup."
          : "On each test device: confirm internet is blocked again.",
    });
    return 0;
  }

  if (command === "cleanup") {
    requireConfirm("cleanup");
    const state = readSpikeState();
    const inventory = await discoverInventory(client, siteId ?? state?.siteId);
    const ids = state?.policyIds?.length
      ? state.policyIds
      : ownedSpikePolicies(inventory.policies).map((policy) => policy.id);
    if (ids.length === 0) {
      console.error("No spike policies to delete. If create may have succeeded, keep the UniFi policy list for recovery.");
      return 1;
    }
    const result = await deletePolicies(client, inventory.site.id, ids);
    let preserved = true;
    try {
      const sourceZoneId = inventory.policies.find((policy) => ids.includes(policy.id))?.source.zoneId;
      const orderingAfter = await client.getPolicyOrdering(inventory.site.id, sourceZoneId);
      const before = state?.orderingBefore
        ? orderedPolicyIds(state.orderingBefore).filter((id) => !ids.includes(id))
        : orderedPolicyIds(inventory.ordering).filter((id) => !ids.includes(id));
      preserved = relativeOrderPreserved(before, orderedPolicyIds(orderingAfter));
    } catch {
      preserved = true;
    }
    if (result.failed.length === 0) clearSpikeState();
    printJson({
      deleted: result.deleted,
      failed: result.failed,
      adminOrderPreserved: preserved,
      recovery: result.failed.length
        ? "Cleanup failed. Leave remaining FamilyFi Spike policies in place and record their ids. Do not delete administrator policies."
        : undefined,
    });
    return result.failed.length === 0 && preserved ? 0 : 1;
  }

  console.error(`Unknown command: ${command}`);
  console.log(help());
  return 2;
}

function familyfiCommit(): string {
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
    const commit = git("rev-parse", "--short=12", "HEAD");
    return git("status", "--porcelain", "--untracked-files=no") ? `${commit}-dirty` : commit;
  } catch {
    return "unknown";
  }
}

async function verify(): Promise<number> {
  if (!process.argv.includes("--confirm")) {
    console.error(
      "Refusing verify without --confirm. It creates, changes and deletes firewall policies on the console, and blocks the test devices' internet.",
    );
    return 2;
  }
  const mock = unifiMockEnabled(process.env);
  let client: UnifiClient;
  let macs = parseMacs();
  if (mock) {
    const fixture = createFixtureUnifiClient({ friendlyNames: true });
    if (macs.length === 0) macs = fixture.state.clients.slice(0, 2).flatMap((item) => (item.macAddress ? [item.macAddress] : []));
    client = fixture;
    console.error("UNIFI_MOCK: running against the local mock. This proves nothing about a gateway and is never a record.");
  } else {
    client = createClient();
  }
  const timeZone = flagValue("--timezone") ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  new Intl.DateTimeFormat("en-US", { timeZone }); // throws on a zone that does not exist
  const known = new Set<string>(VERIFY_SCENARIOS.map((scenario) => scenario.id));
  const only = (flagValue("--only") ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  const unknown = only.filter((id) => !known.has(id));
  if (unknown.length) {
    console.error(`Unknown scenario: ${unknown.join(", ")}. Known: ${[...known].join(", ")}`);
    return 2;
  }

  const deviceChecks = !mock && !process.argv.includes("--no-device-checks") && process.stdin.isTTY === true;
  const prompt = deviceChecks ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const observe: Observe | undefined = prompt
    ? async (question) => {
        const answer = (await prompt.question(`\n  ${question}\n  Is that what you see? [y]es / [n]o / [s]kip: `)).trim().toLowerCase();
        if (answer.startsWith("y")) return true;
        if (answer.startsWith("n")) return false;
        return null;
      }
    : undefined;
  if (!deviceChecks && !mock) {
    console.error("Device checks are off: enforcement will be recorded as not observed.");
  }

  let outcome;
  try {
    outcome = await runVerify({
      confirm: true,
      client,
      mock,
      siteId: process.env.UNIFI_SITE_ID?.trim() || flagValue("--site"),
      macs,
      console: { model: flagValue("--console-model") ?? "", firmware: flagValue("--console-firmware") ?? "" },
      connection: mock ? "mock" : process.env.UNIFI_CONSOLE_ID ? "cloud" : "local",
      familyfi: { version: APP_VERSION, commit: familyfiCommit() },
      timeZone,
      only: only as ScenarioId[],
      observe,
      log: (line) => console.log(line),
    });
  } catch (error) {
    if (error instanceof VerifyRefusedError || (error instanceof Error && /^--console-/.test(error.message))) {
      console.error(error.message);
      return 2;
    }
    throw error;
  } finally {
    prompt?.close();
  }

  const { record, leftoverPolicyIds } = outcome;
  if (leftoverPolicyIds.length) {
    writeSpikeState({
      siteId: outcome.siteId,
      installId: "verify",
      macs,
      policyIds: leftoverPolicyIds,
      orderingBefore: outcome.inventory.ordering,
      createdAt: new Date().toISOString(),
    });
    console.error(
      `${leftoverPolicyIds.length} verification policies could not be deleted. Their ids are in the spike state file: run UNIFI_SPIKE_CONFIRM=1 pnpm spike cleanup.`,
    );
  }

  const dir = flagValue("--out") ?? (mock ? MOCK_RECORD_DIR : VERIFICATION_DIR);
  const written = writeRecord(record, dir, REPO_ROOT);
  if (!mock && path.resolve(REPO_ROOT, dir) === path.resolve(REPO_ROOT, VERIFICATION_DIR)) {
    const testingDoc = path.join(REPO_ROOT, "docs/testing.md");
    const table = renderStatusTable(VERIFY_SCENARIOS, loadRecords(REPO_ROOT));
    writeFileSync(testingDoc, replaceStatusTable(readFileSync(testingDoc, "utf8"), table));
  }
  console.log(`\nRecord: ${path.relative(REPO_ROOT, written.markdown)} and ${path.basename(written.json)}`);
  for (const scenario of record.scenarios) console.log(`  ${scenario.result.padEnd(12)} ${scenario.title}`);
  console.log(`  ${record.restore.result.padEnd(12)} Restore`);
  const failed = record.scenarios.some((scenario) => scenario.result === "fail") || record.restore.result === "fail";
  return failed ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(error instanceof UnifiConfigError ? 2 : 1);
  });
