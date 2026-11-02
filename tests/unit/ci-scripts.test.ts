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
      "test-api-breaking", "test-api-floors", "test-api-version", "test-mutation", "lint", "typecheck", "db-drift", "db-upgrade"];
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
    expect(script).toMatch(/--output "type=image,.*,push=true,rewrite-timestamp=true"/);
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

describe("the :next and :latest tracks", () => {
  // Every release lands on :next as a Pre-release. Only promote.yml moves :latest, when a release
  // stops being a Pre-release, to the image its notes name; and never back to an older release.
  const node = (script: string, args: string[], input: string) =>
    spawnSync(process.execPath, [path.join(repoRoot, script), ...args], { cwd: repoRoot, encoding: "utf8", input });
  const digest = `sha256:${"a".repeat(64)}`;
  const built = (tag: string, prerelease: boolean) => ({
    tag_name: tag,
    prerelease,
    draft: false,
    body: `Image: \`ghcr.io/nickberardi/familyfi@${digest}\` (linux/amd64 and linux/arm64).\n\n## What's Changed`,
  });
  const plan = (tag: string, releases: unknown[]) =>
    node("scripts/ci/promote-plan.mjs", [tag, "nickberardi/FamilyFi"], JSON.stringify(releases));

  it("moves :next only to the newest tag, in SemVer order", () => {
    const newest = (tags: string[]) => node("scripts/ci/newest-tag.mjs", [], tags.join("\n")).stdout.trim();
    expect(newest(["v0.40.0", "v0.39.1", "v0.9.0", "build"])).toBe("v0.40.0");
    expect(newest(["v1.0.0-rc.2", "v1.0.0", "v1.0.0-rc.10"])).toBe("v1.0.0");
    expect(newest(["v1.0.0-rc.2", "v1.0.0-rc.10", "v0.99.0"])).toBe("v1.0.0-rc.10");
    expect(newest(["v0.10.0", "v0.9.9"])).toBe("v0.10.0");
  });

  it("promotes a full release by the digest in its notes, even behind the newest Pre-release", () => {
    const result = plan("v0.38.0", [built("v0.40.0", true), built("v0.38.0", false), built("v0.37.0", false)]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`digest=${digest}\nminor=0.38\nlatest=true\n`);
  });

  it("moves only its line's tag to a fix behind a newer full release, and never a line's tag back", () => {
    const fix = plan("v0.38.1", [built("v0.39.0", false), built("v0.38.1", false), built("v0.38.0", false)]);
    expect(fix.status).toBe(0);
    expect(fix.stdout).toBe(`digest=${digest}\nminor=0.38\nlatest=false\n`);
    expect(fix.stderr).toContain("v0.38.1 is older than v0.39.0, which is already a full release, so only :0.38 moves to it.");

    const behindLatest = node("scripts/ci/promote-plan.mjs", ["v0.37.1", "nickberardi/familyfi", "v0.38.0"], JSON.stringify([built("v0.37.1", false)]));
    expect(behindLatest.status).toBe(0);
    expect(behindLatest.stdout).toContain("latest=false");

    const older = plan("v0.38.0", [built("v0.38.1", false), built("v0.38.0", false)]);
    expect(older.status).toBe(1);
    expect(older.stderr).toContain("v0.38.0 is older than v0.38.1, which is already a full release, so :latest and :0.38 stay where they are.");
  });

  it("leaves a full release whose image is still building to the Release workflow when it fires on the label", () => {
    const building = { ...built("v0.42.1", false), body: "## What's Changed" };
    const later = node("scripts/ci/promote-plan.mjs", ["--if-built", "v0.42.1", "nickberardi/familyfi"], JSON.stringify([building]));
    expect(later.status).toBe(0);
    expect(later.stdout).toBe("");
    expect(later.stderr).toContain("the Release workflow promotes it once it is");
    // By hand it says why nothing moved.
    expect(plan("v0.42.1", [building]).status).toBe(1);

    const release = read(".github/workflows/release.yml");
    expect(release).toMatch(/promote:\n {4}needs: manifest\n {4}if: needs\.manifest\.outputs\.full == 'true'[\s\S]*?uses: \.\/\.github\/workflows\/promote\.yml/);
    const promote = read(".github/workflows/promote.yml");
    expect(promote).toContain("  workflow_call:\n");
    expect(promote).toContain("IF_BUILT: ${{ github.event_name == 'release' && '--if-built' || '' }}");
    expect(promote).toContain('node scripts/ci/promote-plan.mjs $IF_BUILT "$TAG"');
  });

  it("refuses a Pre-release, a release whose notes name no image, and one older than a full release", () => {
    const pre = plan("v0.40.0", [built("v0.40.0", true)]);
    expect(pre.status).toBe(1);
    expect(pre.stderr).toContain("v0.40.0 is still a Pre-release");

    const unnamed = plan("v0.38.0", [{ ...built("v0.38.0", false), body: "Image: `ghcr.io/nickberardi/familyfi:0.38.0`" }]);
    expect(unnamed.status).toBe(1);
    expect(unnamed.stderr).toContain("v0.38.0's notes name no image");

    const older = plan("v0.37.0", [built("v0.37.1", false), built("v0.37.0", false)]);
    expect(older.status).toBe(1);
    expect(older.stderr).toContain("v0.37.0 is older than v0.37.1");

    expect(plan("v0.39.0", [built("v0.38.0", false)]).stderr).toContain("GitHub has no release for v0.39.0");

    // Before the first promotion :latest runs a build no full release names.
    const behind = node("scripts/ci/promote-plan.mjs", ["v0.38.0", "nickberardi/familyfi", "v0.38.1"], JSON.stringify([built("v0.38.0", false)]));
    expect(behind.status).toBe(1);
    expect(behind.stderr).toContain("v0.38.0 is older than v0.38.1, which :latest already runs");
    const again = node("scripts/ci/promote-plan.mjs", ["v0.38.0", "nickberardi/familyfi", "v0.38.0"], JSON.stringify([built("v0.38.0", false)]));
    expect(again.status).toBe(0);
  });

  it("is moved to :latest by promote.yml alone, and every release starts as a Pre-release", () => {
    const latest = /:latest\b/;
    const pushes = (text: string) => text.split("\n").filter((line) => /--tag\b|-t\b/.test(line) && latest.test(line));
    for (const file of [...workflows.filter((f) => !f.endsWith("promote.yml")), "scripts/release.sh"]) {
      expect(pushes(read(file)), file).toEqual([]);
      expect(read(file), file).not.toMatch(/type=raw,value=latest|image:latest"/);
    }
    const promote = read(".github/workflows/promote.yml");
    expect(promote).toMatch(/^on:\n {2}release:\n {4}types: \[released\]$/m);
    expect(promote).toContain('tags=(--tag "$image:${{ steps.plan.outputs.minor }}")');
    expect(promote).toMatch(/if \[ "\$\{\{ steps\.plan\.outputs\.latest \}\}" = "true" \]; then\n\s+tags\+=\(--tag "\$image:latest"\)/);
    expect(read(".github/workflows/release.yml")).toContain("prerelease: true, generate_release_notes: true");
    expect(read("scripts/release.sh")).toContain('--title "$tag" --prerelease --generate-notes');
  });

  it("publishes a build by its digest, tagging nothing but :next", () => {
    for (const file of [".github/workflows/release.yml", "scripts/release.sh"]) {
      const tags = [...read(file).matchAll(/--tag "\$image([:@][^"]*)"/g)].map((match) => match[1]);
      expect(new Set(tags), file).toEqual(new Set(file.endsWith(".yml") ? ["@$digest", ":next"] : [":next"]));
    }
    expect(read("scripts/release.sh")).toContain("push-by-digest=true");
  });
});

describe("a failed Release run", () => {
  // v0.43.1's run failed on a browser flake before it built an image. Its release still read as
  // out, nobody was told, and households on v0.43.0 were correctly offered nothing.
  const failed = () => import("../../scripts/ci/release-failed.mjs");
  const release = { id: 7, name: "v0.43.1", body: "## What's Changed\n* Edit a group", prerelease: false };
  const report = { tag: "v0.43.1", runUrl: "https://github.com/run/1", failedJobs: [{ name: "ci / browser", url: "https://github.com/job/2" }] };

  it("reports the failed jobs and saves a release it deletes, label and all", async () => {
    const { failureReport, savedRelease } = await failed();
    const body = failureReport({ ...report, built: false, release });
    expect(body).toContain("- [ci / browser](https://github.com/job/2)");
    expect(body).toContain("Its full release was deleted");
    expect(body).toContain("`:latest` moves to it");
    expect(savedRelease(body)).toEqual({ name: "v0.43.1", body: release.body, prerelease: false });
    expect(savedRelease(failureReport({ ...report, built: false, release: { ...release, prerelease: true } }))?.prerelease).toBe(true);
  });

  it("keeps a release whose image was built, and saves nothing", async () => {
    const { failureReport, savedRelease } = await failed();
    const body = failureReport({ ...report, built: true, release: null });
    expect(body).toContain("the release stays");
    expect(savedRelease(body)).toBeNull();
    expect(savedRelease("<!-- familyfi-release-failed not-base64 -->")).toBeNull();
  });

  it("is reported by release.yml, which brings the release back once a later attempt names its image", () => {
    const workflow = read(".github/workflows/release.yml");
    const job = workflow.split(/^  failed:$/m)[1]?.split(/^  [\w-]+:$/m)[0];
    expect(job).toContain("needs: [on-main, ci, container, ghcr, manifest, promote, version-pr]");
    expect(job).toContain("if: always() && contains(needs.*.result, 'failure')");
    expect(job).toContain("BUILT: ${{ needs.on-main.result != 'success' || needs.on-main.outputs.published == 'true' || needs.manifest.outputs.named == 'true' }}");
    expect(job).toContain('node scripts/ci/release-failed.mjs fail "$GITHUB_REF_NAME" "$BUILT"');

    const manifest = workflow.split(/^  manifest:$/m)[1].split(/^  promote:$/m)[0];
    const restore = manifest.indexOf('release-failed.mjs restore "$GITHUB_REF_NAME"');
    const named = manifest.indexOf("- name: GitHub Release");
    const settle = manifest.indexOf('release-failed.mjs relabel "$GITHUB_REF_NAME"');
    const full = manifest.indexOf("- name: Already a full release");
    expect(restore).toBeGreaterThan(-1);
    expect(restore).toBeLessThan(named);
    expect(settle).toBeGreaterThan(named);
    expect(settle).toBeLessThan(full);
    expect(manifest).toContain("issues: write");
    expect(manifest).toContain("named: ${{ steps.named.outputs.named }}");
    expect(manifest.indexOf('echo "named=true" >> "$GITHUB_OUTPUT"')).toBeGreaterThan(named);
    expect(manifest).toContain('release-failed.mjs relabel "$GITHUB_REF_NAME" "$RESTORED"');

    // Closed by the job that runs last, so a re-run of a failed promote or version-pr closes it too.
    const succeeded = workflow.split(/^  succeeded:$/m)[1]?.split(/^  [\w-]+:$/m)[0];
    expect(succeeded).toContain("needs: [on-main, manifest, promote, version-pr]");
    expect(succeeded).toContain("!contains(needs.*.result, 'failure')");
    expect(succeeded).toContain('node scripts/ci/release-failed.mjs close "$GITHUB_REF_NAME"');
  });
});

describe("release-failed.mjs against GitHub", () => {
  // A small GitHub: one repository's releases and issues, and the run's jobs.
  function fakeGitHub(releases: Array<Record<string, unknown>>) {
    const issues: Array<Record<string, unknown>> = [];
    const calls: string[] = [];
    let id = 100;
    const json = (status: number, body?: unknown) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status });
    const fetch = async (input: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const route = new URL(input).pathname.replace("/repos/o/r", "");
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push(`${method} ${route}`);
      let match: RegExpMatchArray | null;
      if ((match = route.match(/^\/releases\/tags\/(.+)$/))) {
        const release = releases.find((r) => r.tag_name === decodeURIComponent(match![1]));
        return release ? json(200, release) : json(404, {});
      }
      if (route === "/releases" && method === "GET") return json(200, releases);
      if (route === "/releases" && method === "POST") {
        const release = { ...body, id: id++ };
        releases.push(release);
        return json(201, release);
      }
      if ((match = route.match(/^\/releases\/(\d+)$/))) {
        const index = releases.findIndex((r) => r.id === Number(match![1]));
        if (method === "DELETE") return releases.splice(index, 1) && json(204);
        Object.assign(releases[index], body);
        return json(200, releases[index]);
      }
      if (route.startsWith("/actions/runs/")) {
        return json(200, { jobs: [{ name: "ci / browser", conclusion: "failure", html_url: "https://github.com/job/2" }, { name: "ci / verify", conclusion: "success" }] });
      }
      if (route === "/issues" && method === "GET") return json(200, issues.filter((i) => i.state === "open"));
      if (route === "/issues" && method === "POST") {
        const issue = { ...body, number: id++, state: "open", comments: [] as string[] };
        issues.push(issue);
        return json(201, issue);
      }
      if ((match = route.match(/^\/issues\/(\d+)(\/comments)?$/))) {
        const issue = issues.find((i) => i.number === Number(match![1]))!;
        if (match[2]) (issue.comments as string[]).push(body.body);
        else Object.assign(issue, body);
        return json(200, issue);
      }
      throw new Error(`unexpected ${method} ${route}`);
    };
    return { releases, issues, calls, fetch };
  }

  const env = { GH_TOKEN: "t", GITHUB_REPOSITORY: "o/r", GITHUB_API_URL: "https://api.test", GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "1", GITHUB_OUTPUT: "" };

  async function withGitHub<T>(github: ReturnType<typeof fakeGitHub>, run: () => Promise<T>) {
    const saved = { fetch: globalThis.fetch, env: { ...process.env } };
    globalThis.fetch = github.fetch as typeof fetch;
    Object.assign(process.env, env);
    const log = console.log;
    console.log = () => {};
    try {
      return await run();
    } finally {
      globalThis.fetch = saved.fetch;
      process.env = saved.env;
      console.log = log;
    }
  }

  it("deletes an unbuilt full release after saving it, and a later attempt brings it back as a full release", async () => {
    const { fail, restore, relabel, close } = await import("../../scripts/ci/release-failed.mjs");
    const github = fakeGitHub([{ id: 1, tag_name: "v0.43.1", name: "v0.43.1", body: "## What's Changed", prerelease: false }]);

    await withGitHub(github, () => fail("v0.43.1", false));
    expect(github.releases).toEqual([]);
    expect(github.issues).toHaveLength(1);
    expect(github.issues[0].title).toBe("Release v0.43.1 failed");
    expect(github.issues[0].body).toContain("[ci / browser](https://github.com/job/2)");
    expect(github.issues[0].body).not.toContain("ci / verify");
    // The issue holds the release before the release is gone.
    expect(github.calls.indexOf("POST /issues")).toBeLessThan(github.calls.indexOf("DELETE /releases/1"));

    await withGitHub(github, () => restore("v0.43.1"));
    expect(github.releases).toMatchObject([{ tag_name: "v0.43.1", name: "v0.43.1", body: "## What's Changed", prerelease: true }]);

    await withGitHub(github, () => relabel("v0.43.1", true));
    expect(github.releases[0]).toMatchObject({ prerelease: false, make_latest: "true" });
    expect(github.issues[0].state).toBe("open");
    await withGitHub(github, () => close("v0.43.1"));
    expect(github.issues[0].state).toBe("closed");
  });

  it("keeps a built release, and leaves the label of a release it did not restore", async () => {
    const { fail, relabel } = await import("../../scripts/ci/release-failed.mjs");
    const built = fakeGitHub([{ id: 1, tag_name: "v0.43.1", name: "v0.43.1", body: "Image: x", prerelease: false }]);
    await withGitHub(built, () => fail("v0.43.1", true));
    expect(built.releases).toHaveLength(1);
    expect(built.calls).not.toContain("DELETE /releases/1");

    const github = fakeGitHub([{ id: 1, tag_name: "v0.43.1", name: "v0.43.1", body: "", prerelease: false }]);
    await withGitHub(github, () => fail("v0.43.1", false));
    github.releases.push({ id: 9, tag_name: "v0.43.1", name: "by hand", body: "", prerelease: true });
    await withGitHub(github, () => relabel("v0.43.1", false));
    expect(github.releases[0].prerelease).toBe(true);
  });

  it("saves a release a later attempt deletes in the issue already open", async () => {
    const { fail, restore } = await import("../../scripts/ci/release-failed.mjs");
    const github = fakeGitHub([]);
    await withGitHub(github, () => fail("v0.43.1", false));
    github.releases.push({ id: 5, tag_name: "v0.43.1", name: "v0.43.1", body: "notes", prerelease: false });
    await withGitHub(github, () => fail("v0.43.1", false));
    expect(github.issues).toHaveLength(1);
    expect(github.releases).toEqual([]);
    await withGitHub(github, () => restore("v0.43.1"));
    expect(github.releases).toMatchObject([{ name: "v0.43.1", body: "notes", prerelease: true }]);
  });

  it("restores a fix to an older line without GitHub's Latest badge", async () => {
    const { fail, restore, relabel } = await import("../../scripts/ci/release-failed.mjs");
    const github = fakeGitHub([
      { id: 1, tag_name: "v0.40.0", name: "v0.40.0", body: "", prerelease: false },
      { id: 2, tag_name: "v0.39.1", name: "v0.39.1", body: "", prerelease: false },
    ]);
    await withGitHub(github, () => fail("v0.39.1", false));
    await withGitHub(github, () => restore("v0.39.1"));
    await withGitHub(github, () => relabel("v0.39.1", true));
    expect(github.releases.find((r) => r.tag_name === "v0.39.1")).toMatchObject({ prerelease: false, make_latest: "false" });
  });

  it("says the saved release comes back when an attempt fails after an earlier one deleted it", async () => {
    const { fail } = await import("../../scripts/ci/release-failed.mjs");
    const github = fakeGitHub([{ id: 1, tag_name: "v0.43.1", name: "v0.43.1", body: "", prerelease: false }]);
    await withGitHub(github, () => fail("v0.43.1", false));
    await withGitHub(github, () => fail("v0.43.1", false));
    expect((github.issues[0].comments as string[])[0]).toContain("is saved in this issue and comes back");
  });
});
