/**
 * Browser specs navigate through `tests/browser/fixtures.ts`, whose page retries a navigation
 * once after Chromium reports the host's network changed (`tests/browser/network-change.ts`).
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { NETWORK_CHANGED, retryOnNetworkChange } from "../browser/network-change";

const browserDir = path.resolve(__dirname, "../browser");

function fakePage(failures: Error[]) {
  const calls: string[] = [];
  const page = {
    goto: async (url: string) => {
      calls.push(url);
      const failure = failures.shift();
      if (failure) throw failure;
      return null;
    },
  };
  return { page: retryOnNetworkChange(page as never) as typeof page, calls };
}

describe("retryOnNetworkChange", () => {
  it("loads the page again after the host's network changed", async () => {
    const { page, calls } = fakePage([new Error(`page.goto: ${NETWORK_CHANGED} at http://127.0.0.1:20005/reference`)]);
    await expect(page.goto("/reference")).resolves.toBeNull();
    expect(calls).toEqual(["/reference", "/reference"]);
  });

  it("fails on a second network change", async () => {
    const changed = () => new Error(`page.goto: ${NETWORK_CHANGED}`);
    const { page, calls } = fakePage([changed(), changed()]);
    await expect(page.goto("/rules")).rejects.toThrow(NETWORK_CHANGED);
    expect(calls).toHaveLength(2);
  });

  it("fails at once on any other error", async () => {
    const { page, calls } = fakePage([new Error("page.goto: net::ERR_CONNECTION_REFUSED")]);
    await expect(page.goto("/rules")).rejects.toThrow("ERR_CONNECTION_REFUSED");
    expect(calls).toHaveLength(1);
  });
});

describe("browser specs", () => {
  it("take test from ./fixtures, never straight from @playwright/test", () => {
    const specs = readdirSync(browserDir).filter((f) => f.endsWith(".spec.ts"));
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      const source = readFileSync(path.join(browserDir, spec), "utf8");
      expect(source, spec).toMatch(/import \{[^}]*\btest\b[^}]*\} from "\.\/fixtures";/);
      expect(source, spec).not.toMatch(/from "@playwright\/test"/);
    }
  });
});
