/**
 * `scripts/test.py` is the one way tests and checks run: for people, agents, the pre-push
 * hook and the workflows. This holds the callers to it: the workflows that run tests call
 * no runner of their own, every helper any workflow calls is one the harness calls too,
 * the Makefile's test targets stay aliases for it, and every `scripts/…` path anything
 * names exists after a move. `scripts/release.sh` repeats release.yml.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");
const workflows = readdirSync(path.join(repoRoot, ".github/workflows")).map((f) => `.github/workflows/${f}`);
const harness = readdirSync(path.join(repoRoot, "scripts/testing"))
  .filter((f) => f.endsWith(".py"))
  .map((f) => read(`scripts/testing/${f}`))
  .join("\n");

/** A test runner or check called directly, which would be a second execution path. */
const DIRECT_RUN =
  /\bpnpm (?:run )?(?:test|lint|typecheck|build|audit|test-api|db-drift|db-upgrade)\b|\bvitest\b|\bplaywright test\b|\bstryker\b|prisma migrate/;

const SCRIPT_PATH = /scripts\/[\w./-]+\.(?:sh|mjs|ts|py)/g;
const HELPER = /scripts\/ci\/[\w.-]+\.(?:sh|mjs)/g;

function runScript(script: string, ...args: string[]) {
  return spawnSync("bash", [path.join(repoRoot, script), ...args], { cwd: repoRoot, encoding: "utf8" });
}

describe("the Makefile", () => {
  it("keeps its test and check targets as aliases for scripts/test.py", () => {
    const makefile = read("Makefile");
    const aliases = ["test", "test-unit", "test-coverage", "test-integration", "test-browser", "test-api",
      "test-api-breaking", "test-api-version", "test-mutation", "lint", "typecheck", "db-drift", "db-upgrade"];
    for (const target of aliases) {
      const recipe = makefile.match(new RegExp(`^${target}:\\n((?:\\t.*\\n)+)`, "m"));
      expect(recipe, `make ${target}`).not.toBeNull();
      for (const line of recipe![1].trim().split("\n")) {
        expect(line.trim(), `make ${target}`).toMatch(/^\$\(TEST\) (?:run|check) /);
      }
    }
  });
});

describe("scripts/release.sh", () => {
  it("prints its help, and refuses an unknown option or a missing tag", () => {
    expect(runScript("scripts/release.sh", "--help").status).toBe(0);
    expect(runScript("scripts/release.sh", "--no-such-option").status).toBe(2);
    expect(runScript("scripts/release.sh").status).toBe(2);
  });

  it("accepts --force", () => {
    const result = runScript("scripts/release.sh", "--force");
    expect(result.stderr).toContain("--tag is required");
  });
});

describe("scripts/ paths", () => {
  const sources = [
    ...workflows,
    ".github/actions/runner-cleanup/action.yml",
    ".githooks/pre-push",
    "package.json",
    "Makefile",
    "docker/Dockerfile",
    "prisma.config.ts",
    "tests/playwright.config.ts",
    "scripts/release.sh",
    "scripts/runtime/docker-entrypoint.sh",
    ...readdirSync(path.join(repoRoot, "scripts/testing"))
      .filter((f) => f.endsWith(".py"))
      .map((f) => `scripts/testing/${f}`),
  ];

  it("exist wherever they are named", () => {
    for (const source of sources) {
      for (const [named] of read(source).matchAll(SCRIPT_PATH)) {
        expect(existsSync(path.join(repoRoot, named)), `${source} names ${named}`).toBe(true);
      }
    }
  });
});
