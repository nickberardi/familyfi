import { describe, expect, it, vi } from "vitest";
import {
  compareSemver,
  createUpdateChecker,
  parseSemver,
  selectLatestRelease,
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

  it("uses published prereleases before 1.0 and stable releases at 1.0 or later", () => {
    const releases = [
      { tag_name: "v1.0.0", draft: true },
      { tag_name: "v1.2.0-beta.1", prerelease: true },
      { tag_name: "v1.1.0" },
      { tag_name: "preview", prerelease: false },
    ];
    expect(selectLatestRelease(releases, "0.9.0")).toEqual({ version: "1.2.0-beta.1", tag: "v1.2.0-beta.1" });
    expect(selectLatestRelease(releases, "1.0.0")).toEqual({ version: "1.1.0", tag: "v1.1.0" });
  });

  it("reports a newer release with its canonical GitHub URL", async () => {
    const checker = createUpdateChecker();
    const snapshot = await checker.refresh({
      fetchImpl: vi.fn(async () => jsonResponse([{ tag_name: "v999.0.0", prerelease: true }])),
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
      .mockResolvedValueOnce(jsonResponse([{ tag_name: "v999.0.0", prerelease: true }]));
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
});
