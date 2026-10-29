#!/usr/bin/env node
// Fails when openapi/familyfi.v1.yaml changes in a way that older apps or older servers can't
// follow without raising the floor that says so (docs/api.md, "Versioning the contract"):
//
//   - oasdiff `breaking` finds a change that breaks old apps: info.x-min-app must be the
//     new info.version. The breaking_api label (check-openapi-breaking.sh) approves the change;
//     this records which apps it leaves behind, label or not.
//   - oasdiff `changelog` reports a response gaining a required field: info.x-min-server must
//     be the new info.version, since an older server never sends it.
//   - info.x-min-watch, the watches' floor, is set by hand.
//   - No floor goes backwards, or past info.version.
//
// Usage: node scripts/ci/check-openapi-floors.mjs [base-ref]
// Without a ref it fetches origin/$BASE_REF (default main), the way CI runs it.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { compareSemver, parseSemver } from "./check-openapi-version.mjs";

const SPEC = "openapi/familyfi.v1.yaml";
/** How many of oasdiff's findings a failure lists. */
const SHOWN = 10;
/** oasdiff changelog ids for a response field an older server doesn't send. */
export const SERVER_FLOOR_IDS = new Set(["response-required-property-added", "response-property-became-required"]);

/**
 * @param {{ baseSpec: object, headSpec: object, breaking: string[], requiredAdded: string[] }} input
 *   `breaking` and `requiredAdded` are oasdiff's lines for each kind of change, empty when none.
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function checkFloors({ baseSpec, headSpec, breaking, requiredAdded }) {
  const problems = [];
  const version = String(headSpec?.info?.version ?? "");
  const head = parseSemver(version);
  const floors = [
    { key: "x-min-app", raise: breaking, why: "breaks apps built from older contracts" },
    { key: "x-min-server", raise: requiredAdded, why: "adds required response fields, which older servers don't send" },
    // The watches read only a few routes; until CI can tell which changes reach them, theirs is set by hand.
    { key: "x-min-watch", raise: [], why: "" },
  ];
  for (const { key, raise, why } of floors) {
    const text = String(headSpec?.info?.[key] ?? "");
    const floor = parseSemver(text);
    if (!floor) {
      problems.push(`info.${key} "${text}" is not semver MAJOR.MINOR.PATCH.`);
      continue;
    }
    if (head && compareSemver(floor, head) > 0) problems.push(`info.${key} ${text} is newer than info.version ${version}.`);
    const before = parseSemver(String(baseSpec?.info?.[key] ?? ""));
    if (before && compareSemver(floor, before) < 0) {
      problems.push(`info.${key} went backwards, from ${baseSpec.info[key]} to ${text}: a floor only rises.`);
    }
    if (raise.length && text !== version) {
      problems.push(
        [
          `${SPEC} ${why}:`,
          ...raise.slice(0, SHOWN).map((line) => `  ${line}`),
          ...(raise.length > SHOWN ? [`  and ${raise.length - SHOWN} more`] : []),
          `Set  ${key}: ${version}  (now ${text}) next to version: ${version}.`].join("\n"),
      );
    }
  }
  return { ok: problems.length === 0, problems };
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function oasdiff(...args) {
  const result = spawnSync("sh", ["scripts/ci/oasdiff.sh", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (result.error) throw result.error;
  return result;
}

/** oasdiff's findings between two documents, as one line each. */
function changes(basePath) {
  const breakingRun = oasdiff("breaking", basePath, SPEC, "--fail-on", "ERR", "--format", "json");
  if (breakingRun.status !== 0 && breakingRun.status !== 1) throw new Error(`oasdiff breaking exited ${breakingRun.status}`);
  const changelogRun = oasdiff("changelog", basePath, SPEC, "--format", "json");
  if (changelogRun.status !== 0) throw new Error(`oasdiff changelog exited ${changelogRun.status}`);
  const line = (change) => `${change.operation ?? ""} ${change.path ?? ""}  ${change.text ?? change.id}`.trim();
  const parse = (text) => (text.trim() ? JSON.parse(text) : []);
  const breaking = parse(breakingRun.stdout).filter((change) => change.level >= 3).map(line);
  const requiredAdded = parse(changelogRun.stdout).filter((change) => SERVER_FLOOR_IDS.has(change.id)).map(line);
  return { breaking, requiredAdded };
}

function main() {
  let baseRef = process.argv[2];
  let baseName = baseRef;
  if (!baseRef) {
    baseName = process.env.BASE_REF || "main";
    git("fetch", "--quiet", "--depth=1", "origin", baseName);
    baseRef = "FETCH_HEAD";
  }
  let baseText;
  try {
    baseText = git("show", `${baseRef}:${SPEC}`);
  } catch {
    console.log(`${SPEC} does not exist on ${baseName}; nothing to compare.`);
    return 0;
  }
  const headText = readFileSync(SPEC, "utf8");
  if (baseText === headText) {
    console.log(`${SPEC} is unchanged from ${baseName}.`);
    return 0;
  }
  const work = mkdtempSync(path.join(os.tmpdir(), "familyfi-floors-"));
  try {
    const basePath = path.join(work, "base-openapi.yaml");
    writeFileSync(basePath, baseText);
    const outcome = checkFloors({ baseSpec: YAML.parse(baseText), headSpec: YAML.parse(headText), ...changes(basePath) });
    const info = YAML.parse(headText).info;
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        [
          "### OpenAPI floors",
          "",
          `x-min-app \`${info["x-min-app"]}\`, x-min-server \`${info["x-min-server"]}\`, x-min-watch \`${info["x-min-watch"]}\`, version \`${info.version}\`.`,
          "",
          outcome.ok ? "Passed." : ["```", ...outcome.problems, "```"].join("\n"),
          "",
        ].join("\n"),
      );
    }
    if (!outcome.ok) {
      for (const problem of outcome.problems) console.error(problem);
      return 1;
    }
    console.log(`Floors hold against ${baseName}: x-min-app ${info["x-min-app"]}, x-min-server ${info["x-min-server"]}, x-min-watch ${info["x-min-watch"]}.`);
    return 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main();
}
