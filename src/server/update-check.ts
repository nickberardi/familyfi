import { APP_VERSION } from "@/lib/version";
import type { UpdateCheck } from "@/lib/types";

const GITHUB_RELEASES_URL = "https://api.github.com/repos/nickberardi/familyfi/releases";
const GITHUB_RELEASE_PAGE_URL = "https://github.com/nickberardi/familyfi/releases/tag";
const RELEASE_PAGE_SIZE = 100;
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const UPDATE_CHECK_TIMEOUT_MS = 10_000;

/** A non-secret, process-local snapshot exposed through the health endpoint. */
export type UpdateCheckSnapshot = UpdateCheck;

type Semver = {
  major: string;
  minor: string;
  patch: string;
  prerelease: string[];
  version: string;
};

type GitHubRelease = {
  draft?: unknown;
  prerelease?: unknown;
  tag_name?: unknown;
};

export type UpdateCheckRefreshOptions = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

export type UpdateChecker = {
  getSnapshot(): UpdateCheckSnapshot;
  refresh(options?: UpdateCheckRefreshOptions): Promise<UpdateCheckSnapshot>;
  start(): void;
};

class GitHubHttpError extends Error {
  constructor(readonly status: number) {
    super(`GitHub releases request returned HTTP ${status}.`);
  }
}

const NUMERIC = "(?:0|[1-9]\\d*)";
const IDENTIFIER = "[0-9A-Za-z-]+";
const SEMVER = new RegExp(
  `^(?<major>${NUMERIC})\\.(?<minor>${NUMERIC})\\.(?<patch>${NUMERIC})(?:-(?<prerelease>${IDENTIFIER}(?:\\.${IDENTIFIER})*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`,
);

function compareNumeric(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    if (left.length === right.length) return 0;
    return left.length === 0 ? 1 : -1;
  }
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined || rightPart === undefined) {
      if (leftPart === rightPart) return 0;
      return leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return compareNumeric(leftPart, rightPart);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

/** Strict SemVer, accepting an optional conventional leading `v` in Git tags. */
export function parseSemver(input: string): Semver | null {
  const normalized = input.trim().replace(/^v/, "");
  const match = SEMVER.exec(normalized);
  const groups = match?.groups;
  if (!groups?.major || !groups.minor || !groups.patch) return null;
  const prerelease = groups.prerelease?.split(".") ?? [];
  if (prerelease.some((part) => /^0\d+$/.test(part))) return null;
  return {
    major: groups.major,
    minor: groups.minor,
    patch: groups.patch,
    prerelease,
    version: `${groups.major}.${groups.minor}.${groups.patch}${prerelease.length ? `-${prerelease.join(".")}` : ""}`,
  };
}

/** Returns a negative number when left is older than right. */
export function compareSemver(left: Semver, right: Semver): number {
  for (const part of ["major", "minor", "patch"] as const) {
    const compared = compareNumeric(left[part], right[part]);
    if (compared !== 0) return compared;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

function releaseIsApplicable(release: GitHubRelease, includePrereleases: boolean): Semver | null {
  if (release.draft === true || typeof release.tag_name !== "string") return null;
  const version = parseSemver(release.tag_name);
  if (!version) return null;
  if (!includePrereleases && (release.prerelease === true || version.prerelease.length > 0)) return null;
  return version;
}

export function selectLatestRelease(
  releases: GitHubRelease[],
  currentVersion: string,
): { version: string; tag: string } | null {
  const current = parseSemver(currentVersion);
  if (!current) throw new Error("FamilyFi version is not valid SemVer.");
  const stableOne = parseSemver("1.0.0")!;
  const includePrereleases = compareSemver(current, stableOne) < 0;
  let latest: { version: Semver; tag: string } | null = null;
  for (const release of releases) {
    const version = releaseIsApplicable(release, includePrereleases);
    if (!version || typeof release.tag_name !== "string") continue;
    if (!latest || compareSemver(version, latest.version) > 0) {
      latest = { version, tag: release.tag_name };
    }
  }
  return latest ? { version: latest.version.version, tag: latest.tag } : null;
}

async function fetchReleases(fetchImpl: typeof fetch, signal: AbortSignal): Promise<GitHubRelease[]> {
  const releases: GitHubRelease[] = [];
  for (let page = 1; ; page += 1) {
    const url = new URL(GITHUB_RELEASES_URL);
    url.searchParams.set("per_page", String(RELEASE_PAGE_SIZE));
    url.searchParams.set("page", String(page));
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "FamilyFi update check",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal,
    });
    if (!response.ok) throw new GitHubHttpError(response.status);
    const pageRows: unknown = await response.json();
    if (!Array.isArray(pageRows)) throw new Error("GitHub releases response was not an array.");
    releases.push(...(pageRows as GitHubRelease[]));
    if (pageRows.length < RELEASE_PAGE_SIZE) return releases;
  }
}

function initialSnapshot(): UpdateCheckSnapshot {
  return {
    status: "pending",
    available: null,
    currentVersion: APP_VERSION,
    latestVersion: null,
    releaseUrl: null,
    checkedAt: null,
    lastSuccessfulAt: null,
    error: null,
  };
}

function safeFailureMessage(error: unknown): string {
  if (error instanceof GitHubHttpError) return `GitHub release check returned HTTP ${error.status}.`;
  if (error instanceof Error && error.name === "AbortError") return "GitHub release check timed out.";
  return "GitHub release check failed.";
}

/**
 * A checker is injectable for deterministic tests; production uses the singleton below.
 * It deliberately holds no database state because GitHub availability is reporting only.
 */
export function createUpdateChecker(): UpdateChecker {
  let snapshot = initialSnapshot();
  let inFlight: Promise<UpdateCheckSnapshot> | undefined;
  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const refresh = (options: UpdateCheckRefreshOptions = {}): Promise<UpdateCheckSnapshot> => {
    if (inFlight) return inFlight;
    const fetchImpl = options.fetchImpl ?? fetch;
    const now = options.now ?? (() => new Date());
    inFlight = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);
      try {
        const releases = await fetchReleases(fetchImpl, controller.signal);
        const latest = selectLatestRelease(releases, APP_VERSION);
        const current = parseSemver(APP_VERSION);
        if (!current) throw new Error("FamilyFi version is not valid SemVer.");
        const checkedAt = now().toISOString();
        snapshot = {
          status: "ok",
          available: latest ? compareSemver(parseSemver(latest.version)!, current) > 0 : false,
          currentVersion: APP_VERSION,
          latestVersion: latest?.version ?? null,
          releaseUrl: latest ? `${GITHUB_RELEASE_PAGE_URL}/${encodeURIComponent(latest.tag)}` : null,
          checkedAt,
          lastSuccessfulAt: checkedAt,
          error: null,
        };
      } catch (error) {
        snapshot = {
          status: "error",
          available: null,
          currentVersion: APP_VERSION,
          latestVersion: null,
          releaseUrl: null,
          checkedAt: now().toISOString(),
          lastSuccessfulAt: snapshot.lastSuccessfulAt,
          error: safeFailureMessage(error),
        };
      } finally {
        clearTimeout(timeout);
      }
      return snapshot;
    })().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };

  const start = () => {
    if (started) return;
    started = true;
    const run = () => {
      void refresh().finally(() => {
        timer = setTimeout(run, UPDATE_CHECK_INTERVAL_MS);
        timer.unref?.();
      });
    };
    run();
  };

  return { getSnapshot: () => snapshot, refresh, start };
}

// Next.js bundles instrumentation and route handlers separately. Keep one checker on
// the Node process global so both bundles read the same completed snapshot.
const processState = globalThis as typeof globalThis & { updateChecker?: UpdateChecker };
const updateChecker = processState.updateChecker ??= createUpdateChecker();

export function getUpdateCheckSnapshot(): UpdateCheckSnapshot {
  return updateChecker.getSnapshot();
}

export function refreshUpdateCheck(options?: UpdateCheckRefreshOptions): Promise<UpdateCheckSnapshot> {
  return updateChecker.refresh(options);
}

/** Starts the immediate check and its hourly, non-overlapping refresh loop once per process. */
export function startUpdateCheck(): void {
  updateChecker.start();
}
