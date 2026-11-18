/**
 * Server code never names a household (issue #374). It asks `currentHouseholdId()`, so a shared
 * server can choose the household in one place per request or background pass.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentHouseholdId, DEFAULT_HOUSEHOLD_ID, withHousehold } from "@/server/household-context";

const serverRoot = path.resolve(__dirname, "../../src/server");
const contextFile = path.join(serverRoot, "household-context.ts");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** The default household's id as a string literal: quoted in TypeScript, or inside a raw SQL template. */
const LITERAL = new RegExp(`["'\`]${DEFAULT_HOUSEHOLD_ID}["'\`]`);

/** `default` as a TypeScript keyword or an unrelated string: `export default`, `case "default"`. */
const UNRELATED = /export default|case ["']default["']/;

function namingLines(file: string): string[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line, index) => (LITERAL.test(line) && !UNRELATED.test(line) ? [`${path.relative(serverRoot, file)}:${index + 1}`] : []));
}

describe("household context", () => {
  it("finds the server sources", () => {
    expect(sourceFiles(serverRoot).length).toBeGreaterThan(100);
  });

  it("lets only the household context name the default household", () => {
    const naming = sourceFiles(serverRoot)
      .filter((file) => file !== contextFile)
      .flatMap(namingLines);
    expect(naming).toEqual([]);
  });

  it("reads the default household outside any request or pass", () => {
    expect(currentHouseholdId()).toBe(DEFAULT_HOUSEHOLD_ID);
  });

  it("carries a chosen household through awaited and nested work, and leaves the default after it", async () => {
    const seen = await withHousehold("other", async () => {
      await Promise.resolve();
      const nested = await withHousehold("inner", async () => currentHouseholdId());
      return [currentHouseholdId(), nested];
    });
    expect(seen).toEqual(["other", "inner"]);
    expect(currentHouseholdId()).toBe(DEFAULT_HOUSEHOLD_ID);
  });
});
