import { describe, expect, it, vi } from "vitest";
import {
  compareSemver,
  createUpdateChecker,
  parseSemver,
  selectLatestRelease,
  updateTrack,
} from "@/server/update-check";
import { APP_VERSION } from "@/lib/version";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
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
    const fetchImpl = vi.fn(
      () => new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const first = checker.refresh({ fetchImpl });
    const second = checker.refresh({ fetchImpl });
    expect(first).toBe(second);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    resolveFetch(jsonResponse([]));
    await expect(first).resolves.toMatchObject({ status: "ok", available: false });
  });

  it("reads every release page before selecting the highest version", async () => {
    const checker = createUpdateChecker();
    const firstPage = Array.from({ length: 100 }, () => ({ tag_name: "v0.1.0", prerelease: true }));
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockResolvedValueOnce(jsonResponse([{ tag_name: "v999.0.0", prerelease: false }]));
    const snapshot = await checker.refresh({ fetchImpl });
    expect(snapshot).toMatchObject({ status: "ok", available: true, latestVersion: "999.0.0" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain("page=2");
  });

  it("refreshes hourly after the previous check completes", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchImpl);
    try {
      const checker = createUpdateChecker();
      checker.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000 - 1);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("asks again when an administrator opens a check older than its limit, and reuses a fresh one", async () => {
    // FamilyFi checked before the release left Pre-release; GitHub has promoted it since.
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{ tag_name: "v999.0.0", prerelease: true }]))
      .mockResolvedValueOnce(jsonResponse([{ tag_name: "v999.0.0", prerelease: false }]));
    vi.stubGlobal("fetch", fetchImpl);
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

  it("never asks GitHub from a checker that was not started", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([]));
    const checker = createUpdateChecker();
    await expect(checker.refreshIfOlderThan(0, { fetchImpl })).resolves.toMatchObject({ status: "pending" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
