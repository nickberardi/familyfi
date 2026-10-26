/**
 * `scripts/test.py` is the one way tests and checks run: for people, agents, the pre-push
 * hook and the workflows. This holds the callers to it: the workflows that run tests call
 * no runner of their own, every helper any workflow calls is one the harness calls too,
 * the Makefile's test targets stay aliases for it, and every `scripts/…` path anything
 * names exists after a move. `scripts/release.sh` repeats release.yml.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
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

describe("the release version", () => {
  // v0.25.1 was tagged on a commit whose package.json said 0.25.0, so its image reported
  // 0.25.0 and the update check offered every household the release it already ran.
  it("is stamped into the image before next build bundles package.json", () => {
    const build = read("docker/Dockerfile").split(/^FROM deps AS build$/m)[1].split(/^FROM /m)[0];
    const stamp = build.indexOf('npm pkg set "version=$APP_VERSION"');
    expect(build).toMatch(/^ARG APP_VERSION$/m);
    expect(stamp).toBeGreaterThan(build.indexOf("COPY . ."));
    expect(stamp).toBeLessThan(build.indexOf("next build"));
  });

  it("is the tag's on both release paths", () => {
    expect(read("scripts/release.sh")).toContain('--build-arg "APP_VERSION=$version"');
    const workflow = read(".github/workflows/release.yml");
    expect(workflow).toContain('echo "APP_VERSION=${GITHUB_REF_NAME#v}" >> "$GITHUB_ENV"');
    expect(workflow).toContain("build-args: APP_VERSION=${{ env.APP_VERSION }}");
  });

  it("builds layers that keep their digests while their files do not change, on both release paths", () => {
    const epoch = "git log -1 --format=%ct -- docker/Dockerfile pnpm-lock.yaml";
    const script = read("scripts/release.sh");
    expect(script).toContain(`SOURCE_DATE_EPOCH="$(${epoch})"`);
    expect(script).toContain("--output type=registry,rewrite-timestamp=true");
    const workflow = read(".github/workflows/release.yml");
    expect(workflow).toContain(`echo "SOURCE_DATE_EPOCH=$(${epoch})" >> "$GITHUB_ENV"`);
    expect(workflow).toMatch(/outputs: type=image,.*,rewrite-timestamp=true$/m);
  });

  it("opens a PR bringing main's package.json up to a newer stable tag", () => {
    const job = read(".github/workflows/release.yml").split(/^  version-pr:$/m)[1];
    expect(job).toBeDefined();
    expect(job).toContain('npm pkg set "version=$tag_version"');
    expect(job).toContain("openapi/familyfi.v1.yaml");
    expect(job).toContain(`{base: "main", head: $head, title: $title, body: $body}`);
  });
});

describe("the cloudflared bump", () => {
  it("opens a PR from the update script's pin", () => {
    const workflow = read(".github/workflows/cloudflared.yml");
    expect(workflow).toContain('version="$(scripts/update-cloudflared.sh)"');
    expect(workflow).toContain(`{base: "main", head: $head, title: $title, body: $body}`);
  });

  it("refuses a version that is not one", () => {
    expect(runScript("scripts/update-cloudflared.sh", "latest; rm -rf /").status).toBe(2);
  });
});

describe("reusable workflows", () => {
  // In a called workflow `github.workflow` is the caller's name, so two workflows one run
  // calls (release.yml calls ci.yml and container.yml) would share a concurrency group and
  // cancel each other's jobs. Each names itself in its group instead.
  it("keep a concurrency group of their own when called", () => {
    const groups = workflows
      .filter((file) => /^\s+workflow_call:/m.test(read(file)))
      .map((file) => read(file).match(/^concurrency:\n\s+group: (.+)$/m)?.[1]);
    expect(groups.length).toBeGreaterThan(1);
    for (const group of groups) expect(group).toBeDefined();
    expect(new Set(groups).size).toBe(groups.length);
  });
});

describe("Buildx setup", () => {
  // v0.32.0's container job lost its moby/buildkit pull to a sibling job on the same daemon:
  // "failed to lease content: NotFound: lease ... not found".
  it("tries a BuildKit pull a second time, or pulls none", () => {
    for (const file of workflows) {
      for (const step of read(file).split(/^\s+- /m).filter((s) => s.includes("docker/setup-buildx-action"))) {
        expect(step, file).toMatch(/driver: docker\s*$/m);
      }
    }
    const action = read(".github/actions/setup-buildx/action.yml");
    expect(action.match(/uses: docker\/setup-buildx-action@/g)).toHaveLength(2);
    expect(action).toMatch(/id: first\s+uses: docker\/setup-buildx-action@\S+\s+continue-on-error: true/);
    expect(action).toContain("if: steps.first.outcome == 'failure'");
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

describe("scripts/ci/runner-cleanup.sh", () => {
  /** The docker commands the cleanup runs while `workers` jobs share the daemon and `freeGiB` is free. */
  function dockerCalls(workers: number, freeGiB: number) {
    const bin = mkdtempSync(path.join(os.tmpdir(), "familyfi-cleanup-"));
    try {
      const fake = (name: string, body: string) => {
        writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`);
        chmodSync(path.join(bin, name), 0o755);
      };
      fake("docker", `echo "$*" >> "${bin}/calls"`);
      fake("pgrep", `echo ${workers}`);
      fake("df", `echo "Filesystem 1024-blocks Used Available Capacity Mounted"; echo "/dev/root 128000000 1 ${freeGiB * 1024 * 1024} 1% /"`);
      fake("sudo", "exit 1");
      fake("find", "exit 0");
      const result = spawnSync("sh", [path.join(repoRoot, "scripts/ci/runner-cleanup.sh")], {
        cwd: repoRoot,
        encoding: "utf8",
        // Only the fake directory: never this machine's caches, /tmp or Docker.
        env: { NODE_ENV: "test", PATH: `${bin}:/usr/bin:/bin`, HOME: bin },
      });
      expect(result.status).toBe(0);
      return existsSync(path.join(bin, "calls")) ? readFileSync(path.join(bin, "calls"), "utf8").trim().split("\n") : [];
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  }

  // v0.30.1's release lost its container job when a sibling job's cleanup removed
  // moby/buildkit mid-pull: "failed commit on ref ...: lease does not exist".
  it("keeps tagged images while another job shares the daemon", () => {
    const calls = dockerCalls(2, 80);
    expect(calls).toContain("image prune --force --filter until=24h");
    expect(calls.filter((c) => c.startsWith("image prune --all"))).toEqual([]);
    expect(calls.filter((c) => c.startsWith("system prune"))).toEqual([]);
  });

  it("removes old tagged images anyway when the disk runs low", () => {
    expect(dockerCalls(2, 10)).toContain("image prune --all --force --filter until=24h");
  });

  it("prunes everything when it is the only job", () => {
    expect(dockerCalls(1, 80)).toContain("system prune --all --force --volumes");
  });
});
