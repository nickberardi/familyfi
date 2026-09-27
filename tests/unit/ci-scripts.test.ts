/**
 * `scripts/ci.sh` repeats the CI workflows' jobs for a run on this machine, and
 * `scripts/release.sh` repeats release.yml. A mirror drifts the moment one side
 * changes alone, so this holds them together: every workflow job has a ci.sh job
 * of the same name and the reverse, every helper a workflow calls is one ci.sh
 * calls, and every `scripts/…` path anything names exists after a move.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const repoRoot = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");

/** Workflows ci.sh mirrors. codeql.yml needs the CodeQL CLI and release.yml is release.sh's. */
const MIRRORED = ["ci", "container", "openapi", "mutation"];

/** A workflow's job keeps its name in ci.sh; ci.yml's jobs and a job named after its workflow stay bare. */
function ciJobName(workflow: string, job: string): string {
  return workflow === "ci" || job === workflow ? job : `${workflow}-${job}`;
}

function runScript(script: string, ...args: string[]) {
  return spawnSync("bash", [path.join(repoRoot, script), ...args], { cwd: repoRoot, encoding: "utf8" });
}

function ciShJobs(): string[] {
  const help = runScript("scripts/ci.sh", "--help").stdout;
  const line = help.split("\n").find((l) => l.startsWith("Jobs:"));
  expect(line, "ci.sh --help has a Jobs: line").toBeDefined();
  return line!.replace("Jobs:", "").trim().split(/\s+/);
}

const SCRIPT_PATH = /scripts\/[\w./-]+\.(?:sh|mjs|ts)/g;

describe("scripts/ci.sh mirrors the CI workflows", () => {
  const workflowJobs = MIRRORED.flatMap((workflow) => {
    const doc = YAML.parse(read(`.github/workflows/${workflow}.yml`)) as { jobs: Record<string, unknown> };
    return Object.keys(doc.jobs).map((job) => ciJobName(workflow, job));
  });

  it("has a job for every workflow job, and no job the workflows lack", () => {
    expect(new Set(ciShJobs())).toEqual(new Set(workflowJobs));
  });

  it("calls every helper the mirrored workflows call", () => {
    const ciSh = read("scripts/ci.sh");
    for (const workflow of MIRRORED) {
      for (const [helper] of read(`.github/workflows/${workflow}.yml`).matchAll(SCRIPT_PATH)) {
        expect(ciSh, `${workflow}.yml calls ${helper}; ci.sh does not`).toContain(helper);
      }
    }
  });

  it("prints its help, and refuses an unknown job or option", () => {
    expect(runScript("scripts/ci.sh", "--help").status).toBe(0);
    expect(runScript("scripts/ci.sh", "--only", "no-such-job").status).toBe(2);
    expect(runScript("scripts/ci.sh", "--no-such-option").status).toBe(2);
  });
});

describe("scripts/release.sh", () => {
  it("prints its help, and refuses an unknown option or a missing tag", () => {
    expect(runScript("scripts/release.sh", "--help").status).toBe(0);
    expect(runScript("scripts/release.sh", "--no-such-option").status).toBe(2);
    expect(runScript("scripts/release.sh").status).toBe(2);
  });
});

describe("scripts/ paths", () => {
  const workflows = readdirSync(path.join(repoRoot, ".github/workflows")).map((f) => `.github/workflows/${f}`);
  const sources = [
    ...workflows,
    ".github/actions/runner-cleanup/action.yml",
    "package.json",
    "Makefile",
    "docker/Dockerfile",
    "prisma.config.ts",
    "tests/playwright.config.ts",
    "scripts/ci.sh",
    "scripts/release.sh",
    "scripts/runtime/docker-entrypoint.sh",
  ];

  it("exist wherever they are named", () => {
    for (const source of sources) {
      for (const [named] of read(source).matchAll(SCRIPT_PATH)) {
        expect(existsSync(path.join(repoRoot, named)), `${source} names ${named}`).toBe(true);
      }
    }
  });
});
