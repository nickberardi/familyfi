#!/usr/bin/env node
/**
 * The mutation score per file, as a Markdown table, from Stryker's JSON report. Appends to
 * the file named by the first argument (the job summary in CI), or prints it. The score
 * is the share of mutants a test noticed; each survivor is a change to the code that no
 * test catches, listed with its line in the HTML report.
 */
import { appendFileSync, readFileSync } from "node:fs";

const report = JSON.parse(readFileSync("reports/mutation/mutation.json", "utf8"));
const DETECTED = new Set(["Killed", "Timeout"]);
const UNDETECTED = new Set(["Survived", "NoCoverage"]);

const rows = [];
let detected = 0;
let undetected = 0;
for (const [file, { mutants }] of Object.entries(report.files).sort(([a], [b]) => a.localeCompare(b))) {
  const caught = mutants.filter((mutant) => DETECTED.has(mutant.status)).length;
  const missed = mutants.filter((mutant) => UNDETECTED.has(mutant.status)).length;
  detected += caught;
  undetected += missed;
  rows.push([file, caught, missed]);
}
const score = (caught, missed) => (caught + missed ? `${((100 * caught) / (caught + missed)).toFixed(1)}%` : "n/a");

const markdown = [
  "## Mutation testing",
  "",
  `**${score(detected, undetected)}** of mutants caught (${detected} caught, ${undetected} not). Survivors are in the \`mutation-report\` artifact.`,
  "",
  "| File | Score | Caught | Not caught |",
  "| --- | --- | --- | --- |",
  ...rows.map(([file, caught, missed]) => `| \`${file}\` | ${score(caught, missed)} | ${caught} | ${missed} |`),
  "",
].join("\n");

if (process.argv[2]) appendFileSync(process.argv[2], markdown);
else console.log(markdown);
