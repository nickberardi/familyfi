#!/usr/bin/env node
/**
 * Which lines a pull request changed in measured code that no test runs. Reads the
 * coverage run's coverage/lcov.info and the diff against a base, and reports each
 * uncovered changed line as a GitHub annotation plus a summary. It reports; the coverage
 * floors are what fail a run.
 *
 * usage: node scripts/changed-line-coverage.mjs <base-ref> [summary-file]
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

/** Lines each file added, from a zero-context diff against the base. */
const changed = new Map();
let file = null;
for (const line of execFileSync("git", ["diff", "--unified=0", base, "--", "src"], { cwd: root, encoding: "utf8" }).split("\n")) {
  if (line.startsWith("+++ ")) file = line === "+++ /dev/null" ? null : line.slice(6);
  const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (file && hunk) {
    const [start, count] = [Number(hunk[1]), hunk[2] === undefined ? 1 : Number(hunk[2])];
    const lines = changed.get(file) ?? new Set();
    for (let n = start; n < start + count; n += 1) lines.add(n);
    changed.set(file, lines);
  }
}

/** Executable lines and their hit counts, per measured file. */
const hits = new Map();
for (const record of readFileSync(lcovPath, "utf8").split("end_of_record")) {
  const source = /^SF:(.+)$/m.exec(record)?.[1];
  if (!source) continue;
  const lines = new Map();
  for (const [, line, count] of record.matchAll(/^DA:(\d+),(\d+)/gm)) lines.set(Number(line), Number(count));
  hits.set(path.relative(root, path.resolve(root, source)), lines);
}

let executable = 0;
const uncovered = [];
for (const [changedFile, lines] of changed) {
  const measured = hits.get(changedFile);
  if (!measured) continue;
  for (const line of [...lines].sort((a, b) => a - b)) {
    if (!measured.has(line)) continue;
    executable += 1;
    if (measured.get(line) === 0) uncovered.push({ file: changedFile, line });
  }
}

const covered = executable - uncovered.length;
const headline = executable
  ? `${covered} of ${executable} changed executable lines are run by a test (${((100 * covered) / executable).toFixed(1)}%).`
  : "No changed executable lines in measured code.";
console.log(headline);
for (const { file: where, line } of uncovered.slice(0, 50)) {
  console.log(`::warning file=${where},line=${line}::No test runs this changed line.`);
}
if (summaryFile) {
  const byFile = new Map();
  for (const { file: where, line } of uncovered) byFile.set(where, [...(byFile.get(where) ?? []), line]);
  const rows = [...byFile].map(([where, lines]) => `| \`${where}\` | ${lines.join(", ")} |`);
  appendFileSync(
    summaryFile,
    [`### Changed-line coverage`, "", headline, "", ...(rows.length ? ["| File | Lines no test runs |", "| --- | --- |", ...rows] : []), ""].join("\n"),
  );
}
