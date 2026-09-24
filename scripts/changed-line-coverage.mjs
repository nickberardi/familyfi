#!/usr/bin/env node
/**
 * Which lines a pull request changed in measured code that no test runs. Reads the
 * coverage run's coverage/lcov.info and the diff against a base, and reports each
 * uncovered changed line as a GitHub annotation plus a summary.
 *
 * In the paths `GATED_PATHS` lists, an uncovered changed line fails the run (exit 1).
 * Everywhere else it is reported and the coverage floors decide. A line no test can
 * reach is exempted in the source, where a reviewer sees it, with a comment on the line
 * or the line above: `// coverage-exempt: <why>`. The summary lists every exemption.
 *
 * usage: node scripts/changed-line-coverage.mjs <base-ref> [summary-file]
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Code where an untested changed line fails the run, not just a report. These hold the
 * UniFi key and every write to the household's firewall, sign-in and its guards, and the
 * remote-access tunnel. A file-wide floor averages a new untested branch away, and here
 * that branch is where a wrong pause, bedtime or quarantine, or an open door, would hide.
 * `dir/**` is everything under a directory; any other entry is one file.
 */
export const GATED_PATHS = [
  "src/server/unifi/**",
  "src/server/auth.ts",
  "src/server/guard.ts",
  "src/server/quarantine.ts",
  "src/server/tunnel/**",
  "src/server/reconciliation.ts",
];

const EXEMPT_MARKER = /\/\/\s*coverage-exempt:\s*(\S.*?)\s*$/;

/** Whether a repo-relative path is one `GATED_PATHS` covers. */
export function isGated(file, gated = GATED_PATHS) {
  return gated.some((entry) => (entry.endsWith("/**") ? file.startsWith(entry.slice(0, -2)) : file === entry));
}

/** Lines each file added, from a zero-context diff: `Map<file, Set<line>>`. */
export function parseChangedLines(diff) {
  const changed = new Map();
  let file = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) file = line === "+++ /dev/null" ? null : line.slice(6);
    const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (file && hunk) {
      const [start, count] = [Number(hunk[1]), hunk[2] === undefined ? 1 : Number(hunk[2])];
      const lines = changed.get(file) ?? new Set();
      for (let n = start; n < start + count; n += 1) lines.add(n);
      changed.set(file, lines);
    }
  }
  return changed;
}

/** Executable lines and their hit counts, per measured file: `Map<file, Map<line, hits>>`. */
export function parseLcov(lcov, base = root) {
  const hits = new Map();
  for (const record of lcov.split("end_of_record")) {
    const source = /^SF:(.+)$/m.exec(record)?.[1];
    if (!source) continue;
    const lines = new Map();
    for (const [, line, count] of record.matchAll(/^DA:(\d+),(\d+)/gm)) lines.set(Number(line), Number(count));
    hits.set(path.relative(base, path.resolve(base, source)), lines);
  }
  return hits;
}

/**
 * Why a line is exempt, or undefined. The marker sits at the end of the line itself, or
 * alone on the line above. A marker with no reason exempts nothing.
 */
export function exemptionReason(sourceLines, line) {
  const own = EXEMPT_MARKER.exec(sourceLines[line - 1] ?? "");
  if (own) return own[1];
  const above = sourceLines[line - 2] ?? "";
  const marker = EXEMPT_MARKER.exec(above);
  return marker && above.trim().startsWith("//") ? marker[1] : undefined;
}

/**
 * Sorts every changed executable line into covered, uncovered or exempt. `readSource`
 * returns a file's lines, and is only asked for files with an uncovered changed line.
 */
export function assess({ changed, hits, readSource, gated = GATED_PATHS }) {
  let executable = 0;
  const uncovered = [];
  const exempt = [];
  for (const [file, lines] of changed) {
    const measured = hits.get(file);
    if (!measured) continue;
    let source;
    for (const line of [...lines].sort((a, b) => a - b)) {
      if (!measured.has(line)) continue;
      executable += 1;
      if (measured.get(line) !== 0) continue;
      source ??= readSource(file);
      const reason = exemptionReason(source, line);
      if (reason) exempt.push({ file, line, reason });
      else uncovered.push({ file, line, gated: isGated(file, gated) });
    }
  }
  return { executable, uncovered, exempt };
}

/** GitHub reads `%`, CR and LF in an annotation message as markup. */
function annotation(text) {
  return text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function cell(text) {
  return text.replaceAll("|", "\\|");
}

function main() {
  const [base, summaryFile] = process.argv.slice(2);
  if (!base) {
    console.error("usage: node scripts/changed-line-coverage.mjs <base-ref> [summary-file]");
    process.exit(1);
  }
  const lcovPath = path.join(root, "coverage/lcov.info");
  if (!existsSync(lcovPath)) {
    console.error("coverage/lcov.info is missing: run pnpm test:coverage first.");
    process.exit(1);
  }

  const diff = execFileSync("git", ["diff", "--unified=0", base, "--", "src"], { cwd: root, encoding: "utf8" });
  const { executable, uncovered, exempt } = assess({
    changed: parseChangedLines(diff),
    hits: parseLcov(readFileSync(lcovPath, "utf8")),
    readSource: (file) => readFileSync(path.join(root, file), "utf8").split("\n"),
  });
  const failing = uncovered.filter((item) => item.gated);
  const reported = uncovered.filter((item) => !item.gated);

  const counted = executable - exempt.length;
  const covered = counted - uncovered.length;
  const headline = counted
    ? `${covered} of ${counted} changed executable lines are run by a test (${((100 * covered) / counted).toFixed(1)}%).`
    : "No changed executable lines in measured code.";
  const verdict = failing.length
    ? `${failing.length} changed ${failing.length === 1 ? "line" : "lines"} in gated paths ${failing.length === 1 ? "has" : "have"} no test. Add one, or mark a line no test can reach \`// coverage-exempt: <why>\`.`
    : undefined;
  console.log(headline);
  if (exempt.length) console.log(`${exempt.length} exempt with a coverage-exempt comment.`);
  for (const { file, line } of failing) {
    console.log(`::error file=${file},line=${line}::No test runs this changed line, and ${file} is gated: add a test or mark it // coverage-exempt: <why>.`);
  }
  for (const { file, line } of reported.slice(0, 50)) {
    console.log(`::warning file=${file},line=${line}::No test runs this changed line.`);
  }
  for (const { file, line, reason } of exempt) {
    console.log(`::notice file=${file},line=${line}::${annotation(`Exempt from changed-line coverage: ${reason}`)}`);
  }
  if (verdict) console.error(verdict.replaceAll("`", ""));

  if (summaryFile) {
    const byFile = new Map();
    for (const { file, line, gated } of uncovered) {
      const entry = byFile.get(file) ?? { gated, lines: [] };
      entry.lines.push(line);
      byFile.set(file, entry);
    }
    const rows = [...byFile].map(([file, { gated, lines }]) => `| \`${file}\` | ${gated ? "fails" : "reported"} | ${lines.join(", ")} |`);
    const exemptRows = exempt.map(({ file, line, reason }) => `| \`${file}\` | ${line} | ${cell(reason)} |`);
    appendFileSync(
      summaryFile,
      [
        "### Changed-line coverage",
        "",
        headline,
        ...(verdict ? ["", `**${verdict}**`] : []),
        "",
        ...(rows.length ? ["| File | Gate | Lines no test runs |", "| --- | --- | --- |", ...rows, ""] : []),
        ...(exemptRows.length ? ["#### Exempt lines", "", "| File | Line | Why |", "| --- | --- | --- |", ...exemptRows, ""] : []),
      ].join("\n"),
    );
  }
  if (failing.length) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
