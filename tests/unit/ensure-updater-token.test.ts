import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureUpdaterToken } from "../../scripts/runtime/ensure-updater-token.mjs";

describe("the updater token", () => {
  it("is written once, private to its owner, and never rewritten", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "familyfi-updater-"));
    expect(ensureUpdaterToken(dir)).toBe(true);
    const token = readFileSync(path.join(dir, "token"), "utf8").trim();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(path.join(dir, "token")).mode & 0o777).toBe(0o600);
    expect(ensureUpdaterToken(dir)).toBe(false);
    expect(readFileSync(path.join(dir, "token"), "utf8").trim()).toBe(token);
  });

  it("replaces an empty file, and does nothing without the updater volume", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "familyfi-updater-"));
    writeFileSync(path.join(dir, "token"), "\n");
    expect(ensureUpdaterToken(dir)).toBe(true);
    expect(ensureUpdaterToken(path.join(dir, "missing"))).toBe(false);
  });
});
