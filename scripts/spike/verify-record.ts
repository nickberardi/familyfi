/**
 * The record `pnpm spike verify` leaves behind: a sanitized, dated statement of what a
 * real console did, committed under `docs/verification/` as JSON plus a rendered page.
 *
 * Nothing here is a UniFi response. A record holds scenario ids, check names we wrote,
 * pass/fail, the console model and firmware the operator typed, and the FamilyFi version
 * and commit. The one free-text field, a failed check's detail, goes through `redact`,
 * and `tests/unit/repository-hygiene.test.ts` re-checks every committed file.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const VERIFICATION_DIR = "docs/verification";
export const RECORD_FORMAT = 1;

/** A check's outcome. `not-observed`: nobody watched the test device, so enforcement is unproven. */
export type CheckResult = "pass" | "fail" | "not-observed";
export type ScenarioResult = CheckResult | "skipped";

export type VerifyCheck = { name: string; kind: "api" | "device"; result: CheckResult; detail?: string };

export type ScenarioRecord = {
  id: string;
  title: string;
  result: ScenarioResult;
  checks: VerifyCheck[];
  /** Why a scenario was skipped. */
  note?: string;
};

export type VerifyRecord = {
  format: typeof RECORD_FORMAT;
  /** YYYY-MM-DD, the day the run started. */
  date: string;
  /** A run against `UNIFI_MOCK`. Never committed: the mock proves nothing about a gateway. */
  mock: boolean;
  console: {
    /** Hardware model, as the operator typed it (for example "UCG Max"). */
    model: string;
    /** UniFi OS version, as the operator typed it. */
    firmware: string;
    /** UniFi Network application version, as the console reported it. */
    network: string;
  };
  connection: "local" | "cloud" | "mock";
  familyfi: { version: string; commit: string };
  scenarios: ScenarioRecord[];
  restore: {
    result: "pass" | "fail";
    /** Policies this run created and could not delete. Their ids are in the local spike state file. */
    leftoverPolicies: number;
    /** Policies that appeared during the run and are not on this run's record. Never touched. */
    unexpectedPolicies: number;
    adminPoliciesUnchanged: boolean;
    adminOrderPreserved: boolean;
    detail?: string;
  };
};

const MAC = /\b[0-9a-f]{2}(?:[:-][0-9a-f]{2}){5}\b/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
/** Two or more colon-separated hex groups with a `::`, or four or more colons: an IPv6 address. */
const IPV6 = /(?<![\w:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gi;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const URL_PATTERN = /\bhttps?:\/\/\S+/gi;
/** Anything key-shaped: a long unbroken run of letters, digits and token punctuation. */
const TOKEN = /\b[A-Za-z0-9_\-+/=]{24,}\b/g;
const FREE_TEXT = /^[A-Za-z0-9 .+()_-]{1,40}$/;

function looksLikeIpv6(match: string): boolean {
  return /[0-9a-f]/i.test(match) && (match.includes("::") || match.split(":").length >= 4);
}

/** Replace anything that could identify a household or a credential. */
export function redact(text: string): string {
  return text
    .replace(URL_PATTERN, "<url>")
    .replace(UUID, "<id>")
    .replace(MAC, "<mac>")
    .replace(IPV6, (match) => (looksLikeIpv6(match) ? "<ipv6>" : match))
    .replace(IPV4, "<ipv4>")
    .replace(TOKEN, "<redacted>");
}

/** Everything in `text` that `redact` would have replaced. Empty for a clean record. */
export function householdIdentifiers(text: string): string[] {
  const found = [
    ...(text.match(URL_PATTERN) ?? []),
    ...(text.match(UUID) ?? []),
    ...(text.match(MAC) ?? []),
    ...(text.match(IPV6) ?? []).filter(looksLikeIpv6),
    ...(text.match(IPV4) ?? []),
    ...(text.match(TOKEN) ?? []),
  ];
  return [...new Set(found)];
}

/** Operator-typed labels: short, and plain enough that no address or key fits. */
export function assertLabel(name: string, value: string): string {
  const trimmed = value.trim();
  if (!FREE_TEXT.test(trimmed) || householdIdentifiers(trimmed).length) {
    throw new Error(`${name} must be 1–40 letters, digits, spaces or . + ( ) _ - (got ${JSON.stringify(redact(trimmed))}).`);
  }
  return trimmed;
}

/** A copy of `record` with every free-text field redacted and only known fields kept. */
export function sanitizeRecord(record: VerifyRecord): VerifyRecord {
  return {
    format: RECORD_FORMAT,
    date: record.date,
    mock: record.mock,
    console: { model: redact(record.console.model), firmware: redact(record.console.firmware), network: redact(record.console.network) },
    connection: record.connection,
    familyfi: { version: redact(record.familyfi.version), commit: redact(record.familyfi.commit) },
    scenarios: record.scenarios.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      result: scenario.result,
      checks: scenario.checks.map((check) => ({
        name: redact(check.name),
        kind: check.kind,
        result: check.result,
        ...(check.detail ? { detail: redact(check.detail) } : {}),
      })),
      ...(scenario.note ? { note: redact(scenario.note) } : {}),
    })),
    restore: {
      result: record.restore.result,
      leftoverPolicies: record.restore.leftoverPolicies,
      unexpectedPolicies: record.restore.unexpectedPolicies,
      adminPoliciesUnchanged: record.restore.adminPoliciesUnchanged,
      adminOrderPreserved: record.restore.adminOrderPreserved,
      ...(record.restore.detail ? { detail: redact(record.restore.detail) } : {}),
    },
  };
}

const RESULT_LABEL: Record<ScenarioResult, string> = {
  pass: "pass",
  fail: "**fail**",
  "not-observed": "API only, not observed on a device",
  skipped: "skipped",
};

const CHECK_LABEL: Record<CheckResult, string> = { pass: "pass", fail: "**fail**", "not-observed": "not observed" };

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** The human-readable page committed next to the JSON. */
export function renderRecordMarkdown(input: VerifyRecord): string {
  const record = sanitizeRecord(input);
  const lines = [
    `# Verification ${record.date}: ${record.console.model}, Network ${record.console.network}`,
    "",
    record.mock
      ? "> **Mock run.** `UNIFI_MOCK` stands in for a gateway, so this proves nothing about enforcement. Never commit it."
      : "> Written by `pnpm spike verify`. Device checks are the operator's own observations of the test devices.",
    "",
    "| | |",
    "| --- | --- |",
    `| Date | ${record.date} |`,
    `| Console | ${cell(record.console.model)} |`,
    `| UniFi OS | ${cell(record.console.firmware)} |`,
    `| UniFi Network | ${cell(record.console.network)} |`,
    `| Connection | ${record.connection} |`,
    `| FamilyFi | ${cell(record.familyfi.version)} (${cell(record.familyfi.commit)}) |`,
    `| Restore | ${record.restore.result === "pass" ? "pass" : "**fail**"}: ${record.restore.leftoverPolicies} left over, ${record.restore.unexpectedPolicies} unexpected, administrator policies ${record.restore.adminPoliciesUnchanged ? "unchanged" : "**changed**"}, order ${record.restore.adminOrderPreserved ? "preserved" : "**changed**"}${record.restore.detail ? ` (${cell(record.restore.detail)})` : ""} |`,
    "",
    "## Scenarios",
    "",
    "| Scenario | Result |",
    "| --- | --- |",
    ...record.scenarios.map((scenario) => `| ${cell(scenario.title)} | ${RESULT_LABEL[scenario.result]} |`),
  ];
  for (const scenario of record.scenarios) {
    lines.push("", `### ${scenario.title}`, "", `\`${scenario.id}\`: ${RESULT_LABEL[scenario.result]}${scenario.note ? `. ${scenario.note}` : ""}`);
    if (scenario.checks.length === 0) continue;
    lines.push("", "| Check | Kind | Result |", "| --- | --- | --- |");
    for (const check of scenario.checks) {
      const detail = check.detail ? `: ${cell(check.detail)}` : "";
      lines.push(`| ${cell(check.name)} | ${check.kind} | ${CHECK_LABEL[check.result]}${detail} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** `<date>-network-<version>`, with `-2`, `-3`… for a second run the same day. */
export function recordBaseName(record: VerifyRecord, taken: (base: string) => boolean = () => false): string {
  const version = record.console.network.replace(/[^A-Za-z0-9.]+/g, "-").replace(/^-|-$/g, "") || "unknown";
  const stem = `${record.date}-network-${version}${record.mock ? "-mock" : ""}`;
  let base = stem;
  for (let n = 2; taken(base); n += 1) base = `${stem}-${n}`;
  return base;
}

/**
 * Write `<base>.json` and `<base>.md` into `dir`. A mock record never goes into
 * `docs/verification/`: it would read as proof that a gateway enforces a block.
 */
export function writeRecord(record: VerifyRecord, dir: string, repoRoot: string): { json: string; markdown: string } {
  const resolved = path.resolve(repoRoot, dir);
  if (record.mock && resolved === path.resolve(repoRoot, VERIFICATION_DIR)) {
    throw new Error(`A mock run is not a verification record. Write it somewhere other than ${VERIFICATION_DIR}/.`);
  }
  mkdirSync(resolved, { recursive: true });
  const base = recordBaseName(record, (candidate) => existsSync(path.join(resolved, `${candidate}.json`)));
  const json = path.join(resolved, `${base}.json`);
  const markdown = path.join(resolved, `${base}.md`);
  writeFileSync(json, `${JSON.stringify(sanitizeRecord(record), null, 2)}\n`);
  writeFileSync(markdown, renderRecordMarkdown(record));
  return { json, markdown };
}

export type StoredRecord = { file: string; record: VerifyRecord };

/** Every record in `docs/verification/`, oldest first. */
export function loadRecords(repoRoot: string): StoredRecord[] {
  const dir = path.join(repoRoot, VERIFICATION_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => ({ file, record: JSON.parse(readFileSync(path.join(dir, file), "utf8")) as VerifyRecord }));
}

export const STATUS_TABLE_START = "<!-- verification-status:start (pnpm spike verify writes this table) -->";
export const STATUS_TABLE_END = "<!-- verification-status:end -->";

/**
 * The table in docs/testing.md: each scenario, and the latest committed record that ran
 * it. `scenarios` is the named list in the order the verify mode runs it.
 */
export function renderStatusTable(scenarios: readonly { id: string; title: string }[], records: StoredRecord[]): string {
  const lines = ["| Scenario | Latest result | Record |", "| --- | --- | --- |"];
  for (const scenario of scenarios) {
    let latest: { file: string; record: VerifyRecord; result: ScenarioResult } | undefined;
    for (const stored of records) {
      if (stored.record.mock) continue;
      const ran = stored.record.scenarios.find((item) => item.id === scenario.id);
      if (!ran || ran.result === "skipped") continue;
      if (!latest || stored.record.date >= latest.record.date) latest = { ...stored, result: ran.result };
    }
    lines.push(
      latest
        ? `| ${scenario.title} | ${RESULT_LABEL[latest.result]} | [${latest.record.date}, ${cell(latest.record.console.model)}, Network ${cell(latest.record.console.network)}](verification/${latest.file.replace(/\.json$/, ".md")}) |`
        : `| ${scenario.title} | not run | |`,
    );
  }
  return lines.join("\n");
}

/** `doc` with the text between the status markers replaced by `table`. */
export function replaceStatusTable(doc: string, table: string): string {
  const start = doc.indexOf(STATUS_TABLE_START);
  const end = doc.indexOf(STATUS_TABLE_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error("docs/testing.md has lost its verification status markers.");
  }
  return `${doc.slice(0, start + STATUS_TABLE_START.length)}\n${table}\n${doc.slice(end)}`;
}
