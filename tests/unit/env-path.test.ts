import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveEnvPath } from "../../scripts/print-database-url.mjs";

describe("resolveEnvPath", () => {
  it("prefers FAMILYFI_ENV_PATH, then FAMILYFI_DATA_DIR/.env, then root .env", () => {
    const root = mkdtempSync(path.join(tmpdir(), "familyfi-root-"));
    const empty: Record<string, string | undefined> = {};
    expect(resolveEnvPath(empty, root)).toBe(path.join(root, ".env"));
    expect(resolveEnvPath({ FAMILYFI_DATA_DIR: "/data" }, root)).toBe(path.join("/data", ".env"));
    expect(resolveEnvPath({ FAMILYFI_DATA_DIR: "/data", FAMILYFI_ENV_PATH: "/custom/.env" }, root)).toBe(
      path.resolve("/custom/.env"),
    );
  });
});
