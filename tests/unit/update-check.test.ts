import { describe, expect, it, vi } from "vitest";
import {
  compareSemver,
  createUpdateChecker,
  parseSemver,
  selectLatestRelease,
  selectOfferedRelease,
  trackTag,
  updateTrack,
  UPDATE_CHECK_FRESH_MS,
  UPDATE_CHECK_NOW_MS,
} from "@/server/update-check";
import { APP_VERSION } from "@/lib/version";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const isGitHub = (input: unknown) => String(input).startsWith("https://api.github.com/");
const digestOf = (letter: string) => `sha256:${letter.repeat(64)}`;
const imageLine = (letter: string) => `Image: \`ghcr.io/nickberardi/familyfi@${digestOf(letter)}\` (linux/amd64 and linux/arm64).`;

/** GHCR as an anonymous pull sees it: each tag's digest, and 404 for any other. */
function registry(tags: Record<string, string>) {
  return async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    if (url.pathname === "/token") return jsonResponse({ token: "anonymous" });
    const tag = decodeURIComponent(url.pathname.split("/manifests/")[1] ?? "");
    const digest = tags[tag];
    expect(init?.method).toBe("HEAD");
    return digest ? new Response(null, { status: 200, headers: { "docker-content-digest": digest } }) : new Response(null, { status: 404 });
  };
}

/** GitHub answers with `github`; GHCR with `tags`, or 404 for every tag. */
function routed(github: () => Promise<Response> | Response, tags: Record<string, string> = {}) {
  const ghcr = registry(tags);
  return async (input: string | URL | Request, init?: RequestInit) => (isGitHub(input) ? github() : ghcr(input, init));
}

describe("GitHub release update check", () => {
  it("compares SemVer including prerelease precedence", () => {
    expect(compareSemver(parseSemver("1.0.0-alpha.2")!, parseSemver("1.0.0-alpha.10")!)).toBeLessThan(0);
    expect(compareSemver(parseSemver("1.0.0-rc.1")!, parseSemver("1.0.0")!)).toBeLessThan(0);
    expect(parseSemver("v1.2.3+build.4")?.version).toBe("1.2.3");
    expect(parseSemver("v01.2.3")).toBeNull();
    expect(parseSemver("not-a-release")).toBeNull();
  });

  it("offers the latest track only releases not marked Pre-release, and the next track every release", () => {
    const releases = [
      { tag_name: "v1.3.0", draft: true },
      { tag_name: "v1.2.0", prerelease: true },
      { tag_name: "v1.1.0", prerelease: false },
      { tag_name: "v1.0.0" },
      { tag_name: "preview", prerelease: false },
    ];
    expect(selectLatestRelease(releases, "latest")).toEqual({ version: "1.1.0", tag: "v1.1.0" });
    expect(selectLatestRelease(releases, "next")).toEqual({ version: "1.2.0", tag: "v1.2.0" });
    // Before 1.0 too: a household on :latest is not offered a build only :next has.
    expect(selectLatestRelease([{ tag_name: "v0.38.0", prerelease: true }], "latest")).toBeNull();
  });

  it("offers a line's track only that line's releases not marked Pre-release", () => {
    const releases = [
      { tag_name: "v0.39.0", prerelease: false },
      { tag_name: "v0.38.2", prerelease: true },
      { tag_name: "v0.38.1", prerelease: false },
      { tag_name: "v0.3.8", prerelease: false },
    ];
    expect(selectLatestRelease(releases, { major: "0", minor: "38" })).toEqual({ version: "0.38.1", tag: "v0.38.1" });
    expect(selectLatestRelease(releases, { major: "1", minor: "0" })).toBeNull();
  });

  it("reads the track from FAMILYFI_UPDATE_TAG, and anything it does not know as latest", () => {
    expect(updateTrack("next")).toBe("next");
    expect(updateTrack(" next ")).toBe("next");
    expect(updateTrack("Next")).toBe("latest");
    expect(updateTrack("latest")).toBe("latest");
    expect(updateTrack("0.38")).toEqual({ major: "0", minor: "38" });
    expect(updateTrack("1.2")).toEqual({ major: "1", minor: "2" });
    expect(updateTrack("v1.2")).toBe("latest");
    expect(updateTrack("0.38.1")).toBe("latest");
    expect(updateTrack("00.38")).toBe("latest");
    expect(updateTrack("nxt")).toBe("latest");
    expect(updateTrack("ghcr.io/nickberardi/familyfi:next")).toBe("latest");
    expect(updateTrack("")).toBe("latest");
    expect(updateTrack(undefined)).toBe("latest");
  });

  it("checks the track FAMILYFI_UPDATE_TAG names", async () => {
    const releases = [{ tag_name: "v999.0.0", prerelease: true }];
    vi.stubEnv("FAMILYFI_UPDATE_TAG", "next");
    try {
      const next = await createUpdateChecker().refresh({ fetchImpl: vi.fn(async () => jsonResponse(releases)) });
      expect(next).toMatchObject({ status: "ok", available: true, latestVersion: "999.0.0" });
    } finally {
      vi.unstubAllEnvs();
    }
    const latest = await createUpdateChecker().refresh({ fetchImpl: vi.fn(async () => jsonResponse(releases)) });
    expect(latest).toMatchObject({ status: "ok", available: false, latestVersion: null });
  });

  it("reports a newer release with its canonical GitHub URL", async () => {
    const checker = createUpdateChecker();
    const snapshot = await checker.refresh({
      fetchImpl: vi.fn(async () => jsonResponse([{ tag_name: "v999.0.0", prerelease: false }])),
      now: () => new Date("2026-09-22T12:00:00.000Z"),
    });
    expect(snapshot).toMatchObject({
      status: "ok",
      available: true,
      latestVersion: "999.0.0",
      releaseUrl: "https://github.com/nickberardi/familyfi/releases/tag/v999.0.0",
      checkedAt: "2026-09-22T12:00:00.000Z",
      lastSuccessfulAt: "2026-09-22T12:00:00.000Z",
      error: null,
    });
  });

  it("carries the latest release's notes, bounded, and null when it has none", async () => {
    const withNotes = await createUpdateChecker().refresh({
      fetchImpl: vi.fn(async () =>
        jsonResponse([
          { tag_name: "v999.0.0", body: "## New\n- Something" },
          { tag_name: "v998.0.0", body: "## Old\n- Other" },
        ]),
      ),
    });
    expect(withNotes.releaseNotes).toBe("## New\n- Something");

    const long = await createUpdateChecker().refresh({
      fetchImpl: vi.fn(async () => jsonResponse([{ tag_name: "v999.0.0", body: "x".repeat(30_000) }])),
    });
    expect(long.releaseNotes).toHaveLength(20_000);

    const none = await createUpdateChecker().refresh({
      fetchImpl: vi.fn(async () => jsonResponse([{ tag_name: "v999.0.0", body: "  " }])),
    });
    expect(none.releaseNotes).toBeNull();
  });

  it("reports no update when GitHub has no applicable published release", async () => {
    const checker = createUpdateChecker();
    const snapshot = await checker.refresh({
      fetchImpl: vi.fn(async () => jsonResponse([{ tag_name: "draft", draft: true }])),
    });
    expect(snapshot).toMatchObject({ status: "ok", available: false, latestVersion: null, releaseUrl: null });
  });

  it("reports up to date when GitHub's latest release is the running version", async () => {
    const checker = createUpdateChecker();
    const snapshot = await checker.refresh({
      fetchImpl: vi.fn(async () => jsonResponse([{ tag_name: `v${APP_VERSION}` }])),
    });
    expect(snapshot).toMatchObject({ status: "ok", available: false, latestVersion: APP_VERSION });
  });

  it("makes GitHub failures explicit without reporting current", async () => {
    const checker = createUpdateChecker();
    const snapshot = await checker.refresh({ fetchImpl: vi.fn(async () => jsonResponse({}, 429)) });
    expect(snapshot).toMatchObject({
      status: "error",
      available: null,
      latestVersion: null,
      releaseUrl: null,
      error: "GitHub release check returned HTTP 429.",
    });
  });

  it("times out a stalled GitHub request without claiming to be current", async () => {
    vi.useFakeTimers();
    try {
      const checker = createUpdateChecker();
      const check = checker.refresh({
        fetchImpl: async (_url, init) => new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
      });
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(check).resolves.toMatchObject({
        status: "error",
        available: null,
        error: "GitHub release check timed out.",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("coalesces overlapping refreshes into one cached check", async () => {
    const checker = createUpdateChecker();
    let resolveFetch!: (response: Response) => void;
    const github = vi.fn(
      () => new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const fetchImpl = routed(github);
    const first = checker.refresh({ fetchImpl });
    const second = checker.refresh({ fetchImpl });
    expect(first).toBe(second);
    expect(github).toHaveBeenCalledTimes(1);
    resolveFetch(jsonResponse([]));
    await expect(first).resolves.toMatchObject({ status: "ok", available: false });
  });

  it("reads every release page before selecting the highest version", async () => {
    const checker = createUpdateChecker();
    const firstPage = Array.from({ length: 100 }, () => ({ tag_name: "v0.1.0", prerelease: true }));
    const pages = [jsonResponse(firstPage), jsonResponse([{ tag_name: "v999.0.0", prerelease: false }])];
    const fetchImpl = vi.fn(routed(() => pages.shift()!));
    const snapshot = await checker.refresh({ fetchImpl });
    expect(snapshot).toMatchObject({ status: "ok", available: true, latestVersion: "999.0.0" });
    const githubCalls = fetchImpl.mock.calls.filter(([input]) => isGitHub(input));
    expect(githubCalls).toHaveLength(2);
    expect(String(githubCalls[1]?.[0])).toContain("page=2");
  });

  it("refreshes hourly after the previous check completes", async () => {
    vi.useFakeTimers();
    const github = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", routed(github));
    try {
      const checker = createUpdateChecker();
      checker.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(github).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000 - 1);
      expect(github).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(github).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("asks again when an administrator opens a check older than its limit, and reuses a fresh one", async () => {
    // FamilyFi checked before the release left Pre-release; GitHub has promoted it since.
    const answers = [jsonResponse([{ tag_name: "v999.0.0", prerelease: true }]), jsonResponse([{ tag_name: "v999.0.0", prerelease: false }])];
    const fetchImpl = vi.fn(async () => answers.shift()!);
    vi.stubGlobal("fetch", routed(fetchImpl));
    try {
      const checker = createUpdateChecker();
      checker.start();
      const first = await checker.refreshIfOlderThan(5 * 60 * 1000);
      expect(first).toMatchObject({ status: "ok", available: false });
      const checkedAt = new Date(first.checkedAt!).getTime();
      const at = (ms: number) => ({ now: () => new Date(checkedAt + ms) });
      await expect(checker.refreshIfOlderThan(5 * 60 * 1000, at(5 * 60 * 1000 - 1))).resolves.toMatchObject({ available: false });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await expect(checker.refreshIfOlderThan(5 * 60 * 1000, at(5 * 60 * 1000))).resolves.toMatchObject({
        status: "ok",
        available: true,
        latestVersion: "999.0.0",
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("checks now unless a check finished in the last fifteen seconds, well inside the five-minute limit", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([{ tag_name: "v999.0.0", prerelease: false }]));
    vi.stubGlobal("fetch", routed(fetchImpl));
    try {
      const checker = createUpdateChecker();
      checker.start();
      const first = await checker.refreshIfOlderThan(UPDATE_CHECK_FRESH_MS);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const checkedAt = new Date(first.checkedAt!).getTime();
      const at = (ms: number) => ({ now: () => new Date(checkedAt + ms) });
      await checker.checkNow(at(UPDATE_CHECK_NOW_MS - 1));
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const asked = await checker.checkNow(at(UPDATE_CHECK_NOW_MS));
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(asked).toMatchObject({ status: "ok", available: true, latestVersion: "999.0.0" });
      // A minute old is fresh enough for opening Maintenance, not for Check now.
      const again = new Date(asked.checkedAt!).getTime();
      await checker.checkNow({ now: () => new Date(again + 60_000) });
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("offers the release the track's tag holds in GHCR, whatever GitHub's labels say", () => {
    // v0.42.1 was published as a full release before its image was built, so promote.yml failed and
    // :latest still holds v0.42.0, which has since been labelled Pre-release again.
    const releases = [
      { tag_name: "v0.43.0", prerelease: true, body: "## What's Changed" },
      { tag_name: "v0.42.1", prerelease: false, body: `${imageLine("b")}\n\n## What's Changed` },
      { tag_name: "v0.42.0", prerelease: true, body: `${imageLine("a")}\n\n## What's Changed` },
    ];
    expect(selectOfferedRelease(releases, "latest", digestOf("a"))).toEqual({ version: "0.42.0", tag: "v0.42.0" });
    // :next holds v0.42.1: v0.43.0 is a Pre-release made on GitHub whose image is still building.
    expect(selectOfferedRelease(releases, "next", digestOf("b"))).toEqual({ version: "0.42.1", tag: "v0.42.1" });
    expect(selectOfferedRelease(releases, "next", digestOf("B"))).toEqual({ version: "0.42.1", tag: "v0.42.1" });
    // GHCR could not say, or holds an image no release names: GitHub's labels decide, as before.
    expect(selectOfferedRelease(releases, "latest", null)).toEqual({ version: "0.42.1", tag: "v0.42.1" });
    expect(selectOfferedRelease(releases, "next", digestOf("c"))).toEqual({ version: "0.43.0", tag: "v0.43.0" });
    expect(selectOfferedRelease([{ ...releases[1]!, draft: true }], "latest", digestOf("b"))).toBeNull();
  });

  it("names the tag each track pulls", () => {
    expect(trackTag("latest")).toBe("latest");
    expect(trackTag("next")).toBe("next");
    expect(trackTag({ major: "0", minor: "38" })).toBe("0.38");
  });

  it("asks GHCR for the tag FAMILYFI_UPDATE_TAG names and offers nothing newer than it holds", async () => {
    const releases = [
      { tag_name: "v999.1.0", prerelease: false, body: imageLine("b") },
      { tag_name: "v999.0.0", prerelease: false, body: imageLine("a") },
      { tag_name: `v${APP_VERSION}`, prerelease: false, body: imageLine("0") },
    ];
    const github = () => jsonResponse(releases);
    // promote.yml has not moved :latest to v999.1.0 yet.
    await expect(createUpdateChecker().refresh({ fetchImpl: routed(github, { latest: digestOf("a"), next: digestOf("b") }) })).resolves.toMatchObject({
      status: "ok",
      available: true,
      latestVersion: "999.0.0",
      releaseUrl: "https://github.com/nickberardi/familyfi/releases/tag/v999.0.0",
      releaseNotes: imageLine("a"),
    });
    // Install would pull what FamilyFi already runs: nothing to offer, though GitHub lists newer.
    await expect(createUpdateChecker().refresh({ fetchImpl: routed(github, { latest: digestOf("0") }) })).resolves.toMatchObject({
      status: "ok",
      available: false,
      latestVersion: APP_VERSION,
    });
    vi.stubEnv("FAMILYFI_UPDATE_TAG", "999.0");
    try {
      const fetchImpl = vi.fn(routed(github, { "999.0": digestOf("a"), latest: digestOf("b") }));
      await expect(createUpdateChecker().refresh({ fetchImpl })).resolves.toMatchObject({ latestVersion: "999.0.0" });
      expect(fetchImpl.mock.calls.map(([input]) => String(input))).toContain("https://ghcr.io/v2/nickberardi/familyfi/manifests/999.0");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("falls back to GitHub's labels when GHCR does not answer", async () => {
    const releases = [{ tag_name: "v999.0.0", prerelease: false, body: imageLine("a") }];
    const down = (async (input: unknown) => (isGitHub(input) ? jsonResponse(releases) : Promise.reject(new TypeError("fetch failed")))) as typeof fetch;
    await expect(createUpdateChecker().refresh({ fetchImpl: down })).resolves.toMatchObject({ status: "ok", available: true, latestVersion: "999.0.0" });
    const refused = (async (input: unknown) => (isGitHub(input) ? jsonResponse(releases) : jsonResponse({}, 403))) as typeof fetch;
    await expect(createUpdateChecker().refresh({ fetchImpl: refused })).resolves.toMatchObject({ status: "ok", available: true, latestVersion: "999.0.0" });
  });

  it("never asks GitHub from a checker that was not started", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([]));
    const checker = createUpdateChecker();
    await expect(checker.refreshIfOlderThan(0, { fetchImpl })).resolves.toMatchObject({ status: "pending" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
