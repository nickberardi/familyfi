/**
 * What 2.0 keeps only for apps before it, and the version that ends each (docs/api.md, "Deprecated
 * in 2.0"). The operator set 2.3.0 for all of it. Every `deprecated: true` in the contract names its
 * `x-removed-in`; every optional field that becomes required names its `x-required-in`; and
 * `info.x-min-app-by` names how far `x-min-app` must have risen by each version. Once `info.version`
 * reaches one of those, this fails until the promise is kept.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { compareSemver, parseSemver } from "../../scripts/ci/check-openapi-version.mjs";

const spec = YAML.parse(readFileSync(path.resolve(__dirname, "../../openapi/familyfi.v1.yaml"), "utf8")) as {
  info: { version: string; "x-min-app": string; "x-min-app-by"?: Record<string, string> };
};
const version = parseSemver(spec.info.version)!;

type Found = { at: string; node: Record<string, unknown> };

/** Every object in the contract, with where it sits. */
function objects(node: unknown, at = "", found: Found[] = []): Found[] {
  if (Array.isArray(node)) node.forEach((item, index) => objects(item, `${at}[${index}]`, found));
  else if (node && typeof node === "object") {
    found.push({ at, node: node as Record<string, unknown> });
    for (const [key, value] of Object.entries(node)) objects(value, at ? `${at}.${key}` : key, found);
  }
  return found;
}

const all = objects(spec);
const reached = (due: unknown) => compareSemver(version, parseSemver(String(due))!) >= 0;

describe("what 2.0 deprecates ends on time", () => {
  it("names the version that removes everything deprecated", () => {
    const deprecated = all.filter(({ node }) => node.deprecated === true);
    expect(deprecated.length).toBeGreaterThan(0);
    for (const { at, node } of deprecated) {
      expect(parseSemver(String(node["x-removed-in"])), `${at} is deprecated but names no x-removed-in`).not.toBeNull();
    }
  });

  it("has removed everything due by this version", () => {
    const due = all.filter(({ node }) => node["x-removed-in"] !== undefined && reached(node["x-removed-in"]));
    expect(due.map(({ at, node }) => `${at} (promised for ${node["x-removed-in"]})`)).toEqual([]);
  });

  it("has made required everything due by this version", () => {
    const due = all.filter(({ node }) => node["x-required-in"] !== undefined && reached(node["x-required-in"]));
    expect(due.map(({ at, node }) => `${at} (promised for ${node["x-required-in"]})`)).toEqual([]);
  });

  it("has raised x-min-app as far as promised by this version", () => {
    const steps = Object.entries(spec.info["x-min-app-by"] ?? {});
    expect(steps.length).toBeGreaterThan(0);
    for (const [by, floor] of steps) {
      if (!reached(by)) continue;
      expect(compareSemver(parseSemver(spec.info["x-min-app"])!, parseSemver(floor)!), `x-min-app must be ${floor} or later from ${by}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("would fail at 2.3.0 as things stand", () => {
    const at = parseSemver("2.3.0")!;
    const overdue = all.filter(({ node }) => ["x-removed-in", "x-required-in"].some((key) => node[key] !== undefined && compareSemver(at, parseSemver(String(node[key]))!) >= 0));
    expect(overdue.length).toBeGreaterThan(0);
  });
});
