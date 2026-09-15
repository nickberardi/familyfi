import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FAMILYFI_DATA_DIR, resolveEnvPath } from "../../scripts/print-database-url.mjs";

describe("resolveEnvPath", () => {
  it("uses repo-root .env when the standard data dir is absent", () => {
    const root = mkdtempSync(path.join(tmpdir(), "familyfi-root-"));
    const empty: Record<string, string | undefined> = {};
    expect(resolveEnvPath(empty, root)).toBe(path.join(root, ".env"));
  });

  it("exports the standard Docker data dir constant", () => {
    expect(FAMILYFI_DATA_DIR).toBe("/var/lib/familyfi/data");
  });
});
