/**
 * `pnpm spike verify` orchestration, run against `MockUnifiClient`: it refuses without
 * `--confirm`, runs the named scenarios in order, restores the console whatever fails, and
 * writes a record with nothing in it that could identify a household.
 */

import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inRecurringWindow } from "@/lib/schedule";
import type { UnifiClient } from "@/server/unifi/client";
import { createFixtureUnifiClient, DEV_MOCK_ADMIN_POLICY_ID, DEV_MOCK_ROGUE_POLICY_ID } from "@/server/unifi/dev-mock";
import type { MockUnifiClient } from "@/server/unifi/mock";
import {
  midnightWindows,
  runVerify,
  scenarioResult,
  VERIFY_SCENARIOS,
  VerifyRefusedError,
  type VerifyOptions,
} from "../../scripts/spike/verify";
import {
  assertLabel,
  householdIdentifiers,
  loadRecords,
  recordBaseName,
  redact,
  renderRecordMarkdown,
  renderStatusTable,
  replaceStatusTable,
  sanitizeRecord,
  writeRecord,
  type StoredRecord,
  type VerifyRecord,
} from "../../scripts/spike/verify-record";

const repoRoot = path.resolve(__dirname, "../..");
const MAC_A = "02:00:00:00:00:01";
const MAC_B = "02:00:00:00:00:02";
/** 23:30 UTC: every bedtime window, including the midnight rollover, can be observed. */
const LATE_EVENING = new Date("2026-09-24T23:30:00Z");

function options(client: UnifiClient, overrides: Partial<VerifyOptions> = {}): VerifyOptions {
  return {
    confirm: true,
    client,
    mock: true,
    macs: [MAC_A, MAC_B],
    console: { model: "", firmware: "" },
    connection: "mock",
    familyfi: { version: "0.0.0-test", commit: "abc123def456" },
    timeZone: "UTC",
    now: () => LATE_EVENING,
    ...overrides,
  };
}

function writes(client: MockUnifiClient) {
  return client.calls.filter((call) => call.method !== "GET");
}

/** `client`, with one method replaced. */
function failing<K extends keyof UnifiClient>(client: UnifiClient, method: K, impl: UnifiClient[K]): UnifiClient {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === method) return impl;
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("spike verify: refusal", () => {
  it("refuses without --confirm, before it reads or writes anything", async () => {
    const client = createFixtureUnifiClient();
    await expect(runVerify(options(client, { confirm: false }))).rejects.toBeInstanceOf(VerifyRefusedError);
    expect(client.calls).toEqual([]);
  });

  it("refuses a live run without a console model and firmware, before it reads anything", async () => {
    const client = createFixtureUnifiClient();
    await expect(runVerify(options(client, { mock: false }))).rejects.toThrow(/--console-model/);
    await expect(runVerify(options(client, { mock: false, console: { model: "UCG Max", firmware: "" } }))).rejects.toThrow(
      /--console-firmware/,
    );
    expect(client.calls).toEqual([]);
  });

  it("refuses without a test MAC, or with one the console does not have, before any write", async () => {
    const client = createFixtureUnifiClient();
    await expect(runVerify(options(client, { macs: [] }))).rejects.toBeInstanceOf(VerifyRefusedError);
    await expect(runVerify(options(client, { macs: ["02:00:00:00:00:77"] }))).rejects.toBeInstanceOf(VerifyRefusedError);
    expect(writes(client)).toEqual([]);
  });
});

describe("spike verify: scenarios", () => {
  it("runs the named scenarios in order and restores the console exactly", async () => {
    const client = createFixtureUnifiClient();
    const before = structuredClone(client.state.policies);
    const { record, leftoverPolicyIds } = await runVerify(options(client, { observe: async () => true }));

    expect(record.scenarios.map((scenario) => scenario.id)).toEqual(VERIFY_SCENARIOS.map((scenario) => scenario.id));
    expect(record.scenarios.map((scenario) => [scenario.id, scenario.result])).toEqual(
      VERIFY_SCENARIOS.map((scenario) => [scenario.id, "pass"]),
    );
    expect(record.restore).toEqual({
      result: "pass",
      leftoverPolicies: 0,
      unexpectedPolicies: 0,
      adminPoliciesUnchanged: true,
      adminOrderPreserved: true,
    });
    expect(leftoverPolicyIds).toEqual([]);
    expect(client.state.policies).toEqual(before);
  });

  it("runs a subset in the list's order, not the order asked for", async () => {
    const client = createFixtureUnifiClient();
    const { record } = await runVerify(options(client, { only: ["ownership-refusal", "ipv4-block-restore"] }));
    expect(record.scenarios.map((scenario) => scenario.id)).toEqual(["ipv4-block-restore", "ownership-refusal"]);
  });

  it("records enforcement as not observed when nobody watches a device", async () => {
    const client = createFixtureUnifiClient();
    const { record } = await runVerify(options(client));
    const byId = Object.fromEntries(record.scenarios.map((scenario) => [scenario.id, scenario.result]));
    expect(byId["client-contract"]).toBe("pass");
    expect(byId["ownership-refusal"]).toBe("pass");
    expect(byId["ipv4-block-restore"]).toBe("not-observed");
    expect(byId["bedtime-midnight"]).toBe("not-observed");
  });

  it("stops a scenario at a failed device check, deletes what it created, and runs the rest", async () => {
    const client = createFixtureUnifiClient();
    const before = structuredClone(client.state.policies);
    let asked = 0;
    const { record } = await runVerify(
      options(client, {
        only: ["ipv4-block-restore", "ipv6-block-restore"],
        observe: async () => (asked++ === 0 ? false : true),
      }),
    );
    const [ipv4, ipv6] = record.scenarios;
    expect(ipv4!.result).toBe("fail");
    // Stopped at the first device check: never disabled, deleted by the restore instead.
    expect(ipv4!.checks.map((check) => check.result)).toEqual(["pass", "fail"]);
    expect(ipv6!.result).toBe("pass");
    expect(record.restore.result).toBe("pass");
    expect(client.state.policies).toEqual(before);
  });

  it("restores the console when a write fails part way through a scenario", async () => {
    const mock = createFixtureUnifiClient();
    const before = structuredClone(mock.state.policies);
    const client = failing(mock, "updatePolicy", async () => {
      throw new Error("UniFi PUT https://192.168.1.1/proxy failed for 3e:22:fb:00:00:01");
    });
    const { record } = await runVerify(options(client, { only: ["pause-resume-schedule", "ownership-refusal"] }));
    const [pause, ownership] = record.scenarios;
    expect(pause!.result).toBe("fail");
    const failed = pause!.checks.find((check) => check.result === "fail")!;
    expect(failed.detail).toBe("UniFi PUT <url> failed for <mac>");
    expect(ownership!.result).toBe("pass");
    expect(record.restore.result).toBe("pass");
    expect(mock.state.policies).toEqual(before);
  });

  it("reports a policy it could not delete as left over, with its id for cleanup", async () => {
    const mock = createFixtureUnifiClient();
    const client = failing(mock, "deletePolicy", async () => {
      throw new Error("console unreachable");
    });
    const { record, leftoverPolicyIds } = await runVerify(options(client, { only: ["ipv4-block-restore"] }));
    expect(record.scenarios[0]!.result).toBe("fail");
    expect(leftoverPolicyIds).toHaveLength(1);
    expect(record.restore).toMatchObject({ result: "fail", leftoverPolicies: 1, adminPoliciesUnchanged: true });
    expect(mock.state.policies.map((policy) => policy.id)).toContain(leftoverPolicyIds[0]);
  });

  it("refuses to write an administrator's policy without sending a request", async () => {
    const client = createFixtureUnifiClient();
    const admin = structuredClone(client.state.policies.find((policy) => policy.id === DEV_MOCK_ADMIN_POLICY_ID));
    const { record } = await runVerify(options(client, { only: ["ownership-refusal"] }));
    expect(record.scenarios[0]!.result).toBe("pass");
    expect(writes(client)).toEqual([]);
    expect(client.state.policies.find((policy) => policy.id === DEV_MOCK_ADMIN_POLICY_ID)).toEqual(admin);
  });

  it("never writes to a policy it did not create, across every scenario", async () => {
    const client = createFixtureUnifiClient();
    await runVerify(options(client, { observe: async () => true }));
    for (const id of [DEV_MOCK_ADMIN_POLICY_ID, DEV_MOCK_ROGUE_POLICY_ID]) {
      expect(writes(client).filter((call) => call.path.endsWith(id))).toEqual([]);
    }
  });

  it("skips what the console or the operator cannot supply", async () => {
    const client = createFixtureUnifiClient();
    client.state.policies = [];
    client.state.ordering = { beforeSystemDefined: [], afterSystemDefined: [] };
    const { record } = await runVerify(options(client, { macs: [MAC_A], only: ["concurrent-macs", "ownership-refusal"] }));
    expect(record.scenarios.map((scenario) => [scenario.id, scenario.result])).toEqual([
      ["concurrent-macs", "skipped"],
      ["ownership-refusal", "skipped"],
    ]);
    expect(record.scenarios.every((scenario) => scenario.note)).toBe(true);
  });

  it("rolls check results up into a scenario result", () => {
    expect(scenarioResult([])).toBe("skipped");
    expect(scenarioResult([{ name: "a", kind: "api", result: "pass" }])).toBe("pass");
    expect(
      scenarioResult([
        { name: "a", kind: "api", result: "pass" },
        { name: "b", kind: "device", result: "not-observed" },
      ]),
    ).toBe("not-observed");
    expect(
      scenarioResult([
        { name: "a", kind: "device", result: "not-observed" },
        { name: "b", kind: "api", result: "fail" },
      ]),
    ).toBe("fail");
  });
});

describe("spike verify: bedtime windows", () => {
  it("builds windows that cross midnight, one holding now and one not, at every minute of the day", () => {
    for (let minute = 0; minute < 24 * 60; minute += 1) {
      const now = new Date(Date.UTC(2026, 8, 24, Math.floor(minute / 60), minute % 60));
      const { inside, outside } = midnightWindows(minute);
      const holds = (window: { start: string; end: string }) =>
        inRecurringWindow(now, { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], ...window }, "UTC");
      expect(inside.start > inside.end, `${minute}: inside crosses midnight`).toBe(true);
      expect(holds(inside), `${minute}: inside holds now`).toBe(true);
      const nearMidnight = minute < 21 || minute > 24 * 60 - 21;
      expect(outside === null, `${minute}: outside exists away from midnight`).toBe(nearMidnight);
      if (outside) {
        expect(outside.start > outside.end, `${minute}: outside crosses midnight`).toBe(true);
        expect(holds(outside), `${minute}: outside excludes now`).toBe(false);
      }
    }
  });
});

function sampleRecord(overrides: Partial<VerifyRecord> = {}): VerifyRecord {
  return {
    format: 1,
    date: "2026-09-24",
    mock: false,
    console: { model: "UCG Max", firmware: "4.3.6", network: "10.4.57" },
    connection: "local",
    familyfi: { version: "0.7.0", commit: "136810d44727" },
    scenarios: [
      {
        id: "ipv4-block-restore",
        title: "IPv4 MAC block and restore",
        result: "fail",
        checks: [
          {
            name: "disables the policy (enabled: false)",
            kind: "api",
            result: "fail",
            detail:
              "UniFi PUT https://192.168.1.1/proxy/network/integration/v1/sites/0b6c3e5a-1f7e-4a0a-9b1e-2f6c8d9e0a1b failed for 3e:22:fb:12:34:56 at fe80::1c2:3dff:fe4e:5f60 with key 9fJk2LmN8pQrStUvWxYz01234567",
          },
        ],
      },
    ],
    restore: {
      result: "pass",
      leftoverPolicies: 0,
      unexpectedPolicies: 0,
      adminPoliciesUnchanged: true,
      adminOrderPreserved: true,
    },
    ...overrides,
  };
}

describe("spike verify: the record", () => {
  it("redacts addresses, ids, URLs and keys", () => {
    expect(redact("MAC 3e:22:fb:12:34:56 and 3E-22-FB-12-34-56")).toBe("MAC <mac> and <mac>");
    expect(redact("from 10.0.0.12 and 2001:db8:85a3::8a2e:370:7334 or fe80::1")).toBe("from <ipv4> and <ipv6> or <ipv6>");
    expect(redact("policy 0b6c3e5a-1f7e-4a0a-9b1e-2f6c8d9e0a1b")).toBe("policy <id>");
    expect(redact("GET https://api.ui.com/v1/connector/consoles/abc failed")).toBe("GET <url> failed");
    expect(redact("X-API-KEY 9fJk2LmN8pQrStUvWxYz01234567")).toBe("X-API-KEY <redacted>");
    // Times and versions are not addresses.
    expect(redact("bedtime 23:00–01:00 at 21:03:05 on Network 10.4.57")).toBe("bedtime 23:00–01:00 at 21:03:05 on Network 10.4.57");
  });

  it("writes and renders nothing that could identify a household", () => {
    const record = sampleRecord();
    const dirty = { ...record, raw: { macAddress: "3e:22:fb:12:34:56" } } as VerifyRecord;
    const clean = sanitizeRecord(dirty);
    expect(clean).not.toHaveProperty("raw");
    expect(householdIdentifiers(JSON.stringify(clean))).toEqual([]);
    expect(householdIdentifiers(renderRecordMarkdown(dirty))).toEqual([]);
    expect(clean.scenarios[0]!.checks[0]!.detail).toBe("UniFi PUT <url> failed for <mac> at <ipv6> with key <redacted>");
  });

  it("keeps a mock run's record free of identifiers too", async () => {
    const { record } = await runVerify(options(createFixtureUnifiClient()));
    expect(householdIdentifiers(JSON.stringify(sanitizeRecord(record)))).toEqual([]);
    expect(householdIdentifiers(renderRecordMarkdown(record))).toEqual([]);
    expect(renderRecordMarkdown(record)).toContain("**Mock run.**");
  });

  it("accepts plain console labels and rejects anything address- or key-shaped", () => {
    expect(assertLabel("--console-model", " UCG Max ")).toBe("UCG Max");
    expect(assertLabel("--console-firmware", "4.3.6")).toBe("4.3.6");
    expect(() => assertLabel("--console-model", "")).toThrow(/--console-model/);
    expect(() => assertLabel("--console-model", "192.168.1.1")).toThrow();
    expect(() => assertLabel("--console-model", "3e:22:fb:12:34:56")).toThrow();
    expect(() => assertLabel("--console-model", "UDM Pro | raw")).toThrow();
  });

  it("names records by date and Network version, numbering a second run the same day", () => {
    const record = sampleRecord();
    expect(recordBaseName(record)).toBe("2026-09-24-network-10.4.57");
    const taken = new Set(["2026-09-24-network-10.4.57", "2026-09-24-network-10.4.57-2"]);
    expect(recordBaseName(record, (base) => taken.has(base))).toBe("2026-09-24-network-10.4.57-3");
    expect(recordBaseName(sampleRecord({ mock: true }))).toBe("2026-09-24-network-10.4.57-mock");
  });

  it("refuses to put a mock record in docs/verification", () => {
    const root = mkdtempSync(path.join(tmpdir(), "familyfi-verify-"));
    expect(() => writeRecord(sampleRecord({ mock: true }), "docs/verification", root)).toThrow(/mock run/);
    const written = writeRecord(sampleRecord(), "docs/verification", root);
    expect(readdirSync(path.join(root, "docs/verification")).sort()).toEqual([
      "2026-09-24-network-10.4.57.json",
      "2026-09-24-network-10.4.57.md",
    ]);
    expect(JSON.parse(readFileSync(written.json, "utf8"))).toEqual(sanitizeRecord(sampleRecord()));
    expect(loadRecords(root)).toEqual([{ file: "2026-09-24-network-10.4.57.json", record: sanitizeRecord(sampleRecord()) }]);
  });
});

describe("spike verify: docs/testing.md", () => {
  it("links each scenario's latest real record, and says not run for the rest", () => {
    const pass = (date: string, network: string, mock = false): StoredRecord => ({
      file: `${date}-network-${network}.json`,
      record: sampleRecord({
        date,
        mock,
        console: { model: "UCG Max", firmware: "4.3.6", network },
        scenarios: [{ id: "ipv4-block-restore", title: "IPv4 MAC block and restore", result: "pass", checks: [] }],
      }),
    });
    const table = renderStatusTable(VERIFY_SCENARIOS, [pass("2026-09-01", "10.4.57"), pass("2026-09-20", "10.5.1"), pass("2026-09-22", "10.6.0", true)]);
    expect(table).toContain(
      "| IPv4 MAC block and restore | pass | [2026-09-20, UCG Max, Network 10.5.1](verification/2026-09-20-network-10.5.1.md) |",
    );
    expect(table).toContain("| IPv6 block and restore | not run | |");
  });

  it("matches the records committed in docs/verification", () => {
    const doc = readFileSync(path.join(repoRoot, "docs/testing.md"), "utf8");
    expect(replaceStatusTable(doc, renderStatusTable(VERIFY_SCENARIOS, loadRecords(repoRoot)))).toBe(doc);
  });

  it("renders each committed record's page from its JSON", () => {
    for (const { file, record } of loadRecords(repoRoot)) {
      const page = readFileSync(path.join(repoRoot, "docs/verification", file.replace(/\.json$/, ".md")), "utf8");
      expect(page, file).toBe(renderRecordMarkdown(record));
    }
  });

  it("refuses a doc that has lost its markers", () => {
    expect(() => replaceStatusTable("# Testing\n", "| table |")).toThrow(/markers/);
  });
});
