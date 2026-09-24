/**
 * Every invariant in AGENTS.md names the tests that enforce it. A rule with no test is a
 * wish: it held until someone broke it. This fails when an invariant names no test, or
 * names a file that does not exist (renamed or deleted without updating AGENTS.md).
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");
const agents = readFileSync(path.join(repoRoot, "AGENTS.md"), "utf8");
const section = /^## Invariants\n([\s\S]*?)\n## /m.exec(agents)?.[1] ?? "";
const invariants = section.split("\n").filter((line) => line.startsWith("- "));

describe("AGENTS.md invariants", () => {
  it("are found", () => {
    expect(invariants.length).toBeGreaterThan(5);
  });

  it.each(invariants.map((line) => [line.slice(2, 70), line]))("%s… names existing tests", (_title, line) => {
    const tests = /\*Tests:\*(.*)$/.exec(line)?.[1] ?? "";
    const files = [...tests.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    expect(files.length, "names at least one test").toBeGreaterThan(0);
    for (const file of files) {
      expect(file, "is under tests/").toMatch(/^tests\//);
      expect(existsSync(path.join(repoRoot, file)), `${file} exists`).toBe(true);
    }
  });
});
