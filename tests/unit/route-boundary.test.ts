/**
 * An `/api/v1` route file checks its caller, reads the request and calls one function in
 * `src/server` (issue #392). It never reaches the database or creates a UniFi client itself, so
 * household logic is testable without HTTP and gateway calls sit in one layer.
 *
 * Route files that still do are listed below while they are converted, one area at a time. The
 * list only shrinks: a converted file that stays listed fails this test too.
 *
 * This reads import specifiers and those function names, not what the code reaches at run time.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const apiRoot = path.resolve(__dirname, "../../src/app/api/v1");

/** The database, and the module that creates UniFi clients. */
const FORBIDDEN = ["@/server/db", "@/server/unifi/connection"];

/** Functions that hand out a UniFi client, whichever module a route takes them from. */
const FORBIDDEN_NAMES = /\b(clientForHousehold|syncClient)\b/;

const NOT_YET_CONVERTED = [
  "auth/session/route.ts",
  "changes/[id]/route.ts",
  "checkup/leftover-policies/remove/route.ts",
  "checkup/run/route.ts",
  "devices/[mac]/assignment/route.ts",
  "devices/[mac]/route.ts",
  "devices/route.ts",
  "dpi/applications/route.ts",
  "dpi/categories/route.ts",
  "health/route.ts",
  "sync/route.ts",
];

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

  it("lets no route file reach the database or a UniFi client, beyond those not yet converted", () => {
    expect(reaching.filter((file) => !NOT_YET_CONVERTED.includes(file))).toEqual([]);
  });

  it("lists no route file that has been converted", () => {
    expect(NOT_YET_CONVERTED.filter((file) => !reaching.includes(file))).toEqual([]);
  });
});
