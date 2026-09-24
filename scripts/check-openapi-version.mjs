#!/usr/bin/env node
// Fails when openapi/familyfi.v1.yaml changes without a matching info.version increase.
//
// The iOS client (familyfi-ios) vendors a copy of this file and generates its client from
// it, so the version is how it tells that its copy is stale. The rule, against the base
// branch (docs/api.md, "Versioning the contract"):
//
//   - Unchanged spec: nothing to check.
//   - Only info.version, `description` or `summary` text changed: any semver increase; a patch is enough.
//   - Anything else changed: at least a minor increase.
//   - A major increase only with the `breaking-api` label (BREAKING_API_APPROVED=true).
//   - With that label from 1.0.0 on, a major increase. Before 1.0.0 a minor one carries
//     the break, as semver allows for 0.y.z.
//
// Usage: node scripts/check-openapi-version.mjs [base-ref]
// Without a ref it fetches origin/$BASE_REF (default main), the way CI runs it.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import YAML from "yaml";

const SPEC = "openapi/familyfi.v1.yaml";
const IOS_SPEC = "familyfi-ios/openapi/familyfi.v1.yaml";
const PROSE_KEYS = new Set(["description", "summary"]);
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;

/** @returns {{ major: number, minor: number, patch: number, prerelease: string[] } | null} */
export function parseSemver(version) {
  const match = SEMVER.exec(String(version ?? ""));
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

/** Semver precedence: negative when a < b, 0 when equal, positive when a > b. */
export function compareSemver(a, b) {
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  if (!a.prerelease.length || !b.prerelease.length) return b.prerelease.length - a.prerelease.length;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) return Number(x) - Number(y);
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** The largest part that increased: "major", "minor" or "patch" (which covers a prerelease step). */
export function bumpKind(from, to) {
  if (to.major !== from.major) return "major";
  if (to.minor !== from.minor) return "minor";
  return "patch";
}

// The document with its prose and its version removed. `properties` maps a schema's field
// names, where a field called `description` or `summary` is contract, not prose.
function withoutProse(node, parentKey = "") {
  if (Array.isArray(node)) return node.map((item) => withoutProse(item));
  if (node === null || typeof node !== "object") return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (parentKey !== "properties" && PROSE_KEYS.has(key)) continue;
    out[key] = withoutProse(value, key);
  }
  return out;
}

function withoutVersion(spec) {
  const copy = structuredClone(spec);
  if (copy?.info) delete copy.info.version;
  return copy;
}

/** "none", "version" (only info.version), "prose" (description and summary text too) or "contract". */
export function classifyChange(baseSpec, headSpec) {
  const same = (strip) => JSON.stringify(strip(baseSpec)) === JSON.stringify(strip(headSpec));
  if (same((spec) => spec)) return "none";
  if (same(withoutVersion)) return "version";
  return same((spec) => withoutProse(withoutVersion(spec))) ? "prose" : "contract";
}

/**
 * @param {{ baseSpec: object, headSpec: object, breakingApproved?: boolean }} input
 * @returns {{ ok: boolean, change: string, from: string, to: string, message: string }}
 */
export function checkVersion({ baseSpec, headSpec, breakingApproved = false }) {
  const fromText = String(baseSpec?.info?.version ?? "");
  const toText = String(headSpec?.info?.version ?? "");
  const change = classifyChange(baseSpec, headSpec);
  const result = (ok, message) => ({ ok, change, from: fromText, to: toText, message });

  if (change === "none") return result(true, `${SPEC} is unchanged.`);
  const from = parseSemver(fromText);
  const to = parseSemver(toText);
  if (!from) return result(false, `The base branch's info.version "${fromText}" is not semver; fix it there first.`);
  if (!to) return result(false, `info.version "${toText}" is not semver MAJOR.MINOR.PATCH.`);
  if (compareSemver(to, from) <= 0) {
    const need = change === "contract" ? "a minor (or larger)" : "a patch (or larger)";
    return result(
      false,
      `${SPEC} changed but info.version went from ${fromText} to ${toText}. ` +
        `Raise it by ${need} increase, and package.json's version with it.`,
    );
  }
  const kind = bumpKind(from, to);
  if (kind === "major" && !breakingApproved) {
    return result(
      false,
      `info.version ${fromText} -> ${toText} is a major increase, which needs the breaking-api label. ` +
        `The operator adds it; otherwise raise the minor version instead.`,
    );
  }
  if (breakingApproved && from.major >= 1 && kind !== "major") {
    return result(
      false,
      `The breaking-api label approves a breaking change, which from 1.0.0 on needs a major increase; ` +
        `info.version went ${fromText} -> ${toText}.`,
    );
  }
  if (change === "contract" && kind === "patch") {
    return result(
      false,
      `${SPEC} changed more than description or summary text, so ${fromText} -> ${toText} needs ` +
        `at least a minor increase (${from.major}.${from.minor + 1}.0).`,
    );
  }
  const what = {
    version: "Only info.version changed",
    prose: "Only description or summary text changed",
    contract: "The contract changed",
  }[change];
  return result(true, `${what}; info.version ${fromText} -> ${toText} is a ${kind} increase.`);
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
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
  const outcome = checkVersion({
    baseSpec: YAML.parse(baseText),
    headSpec: YAML.parse(readFileSync(SPEC, "utf8")),
    breakingApproved: process.env.BREAKING_API_APPROVED === "true",
  });

  if (outcome.change !== "none" && process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        "### OpenAPI version",
        "",
        `The iOS client vendors \`${SPEC}\` and generates its client from it. ` +
          `After this merges, refresh \`${IOS_SPEC}\` from it.`,
        "",
        "| | info.version |",
        "| --- | --- |",
        `| ${baseName} | \`${outcome.from || "none"}\` |`,
        `| This pull request | \`${outcome.to || "none"}\` |`,
        "",
        `${outcome.ok ? "Passed" : "Failed"}: ${outcome.message}`,
        "",
      ].join("\n"),
    );
  }
  if (!outcome.ok) {
    console.error(outcome.message);
    return 1;
  }
  console.log(outcome.message);
  if (outcome.change !== "none") {
    console.log(`The iOS client vendors ${SPEC}: refresh ${IOS_SPEC} (${outcome.from} -> ${outcome.to}).`);
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main();
}
