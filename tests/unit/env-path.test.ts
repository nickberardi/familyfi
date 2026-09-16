import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DATA_DIR, resolveEnvPath } from "../../scripts/print-database-url.mjs";

describe("resolveEnvPath", () => {
  it("uses repo-root .env when the standard data dir is absent", () => {
    // Container images set /.dockerenv and prefer /var/lib/familyfi/data/.env.
    if (existsSync("/.dockerenv") || existsSync(DATA_DIR)) {
      expect(resolveEnvPath({}, mkdtempSync(path.join(tmpdir(), "familyfi-root-")))).toBe(
        path.join(DATA_DIR, ".env"),
      );
      return;
    }
    const root = mkdtempSync(path.join(tmpdir(), "familyfi-root-"));
    const empty: Record<string, string | undefined> = {};
    expect(resolveEnvPath(empty, root)).toBe(path.join(root, ".env"));
  });

  it("exports the standard Docker data dir constant", () => {
    expect(DATA_DIR).toBe("/var/lib/familyfi/data");
  });
});
