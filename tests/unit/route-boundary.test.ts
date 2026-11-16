/**
 * An `/api/v1` route file checks its caller, reads the request and calls one function in
 * `src/server` (issue #392). It never reaches the database or creates a UniFi client itself, so
 * household logic is testable without HTTP and gateway calls sit in one layer.
 *
 * This reads import specifiers and those function names, not what the code reaches at run time.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const apiRoot = path.resolve(__dirname, "../../src/app/api/v1");

/** The database, and the module that creates UniFi clients. */
const FORBIDDEN = ["@/server/db", "@/server/unifi/connection"];

/**
 * Functions that hand out a UniFi client, call the gateway or read the household row: each is a
 * step of household logic, whichever module a route takes it from.
 */
const FORBIDDEN_NAMES = /\b(clientForHousehold|syncClient|listSiteNetworks|loadHousehold)\b/;

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

function reaches(file: string): boolean {
  const source = readFileSync(file, "utf8");
  if (FORBIDDEN_NAMES.test(source)) return true;
  return FORBIDDEN.some((module) => new RegExp(`from\\s+["']${module}["']|import\\(\\s*["']${module}["']`).test(source));
}

describe("route boundary", () => {
  const reaching = routeFiles(apiRoot)
    .filter(reaches)
    .map((file) => path.relative(apiRoot, file).split(path.sep).join("/"))
    .sort();

  it("finds the route files", () => {
    expect(routeFiles(apiRoot).length).toBeGreaterThan(50);
  });

  it("lets no route file reach the database or a UniFi client", () => {
    expect(reaching).toEqual([]);
  });
});
