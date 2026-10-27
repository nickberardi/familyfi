import { APP_VERSION } from "@/lib/version";
import type { UpdateCheck } from "@/lib/types";
import { compareSemver, parseSemver, type Semver } from "@/lib/semver";
import { updateTrackFor, type UpdateTrack } from "@/lib/update-track";
import { unrefTimer } from "./unref-timer";

export { compareSemver, parseSemver };

const GITHUB_RELEASES_URL = "https://api.github.com/repos/nickberardi/familyfi/releases";
const GITHUB_RELEASE_PAGE_URL = "https://github.com/nickberardi/familyfi/releases/tag";
const RELEASE_PAGE_SIZE = 100;
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const UPDATE_CHECK_TIMEOUT_MS = 10_000;
const RELEASE_NOTES_MAX_CHARS = 20_000;

/** A non-secret, process-local snapshot exposed through the health endpoint. */
export type UpdateCheckSnapshot = UpdateCheck;

type GitHubRelease = {
  draft?: unknown;
  prerelease?: unknown;
  tag_name?: unknown;
  body?: unknown;
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

export type { UpdateTrack };

/** The household's track, from `FAMILYFI_UPDATE_TAG` (`src/lib/update-track.ts`). */
export function updateTrack(tag: string | undefined = process.env.FAMILYFI_UPDATE_TAG): UpdateTrack {
  return updateTrackFor(tag);
}

function releaseIsApplicable(release: GitHubRelease, track: UpdateTrack): Semver | null {
  if (release.draft === true || typeof release.tag_name !== "string") return null;
  const version = parseSemver(release.tag_name);
  if (!version) return null;
  if (track !== "next" && release.prerelease === true) return null;
  if (typeof track === "object" && (version.major !== track.major || version.minor !== track.minor)) return null;
  return version;
}

export function selectLatestRelease(
  releases: GitHubRelease[],
  track: UpdateTrack,
): { version: string; tag: string } | null {
  let latest: { version: Semver; tag: string } | null = null;
  for (const release of releases) {
    const version = releaseIsApplicable(release, track);
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

/** The markdown body GitHub holds for a tag, bounded; null when the release has none. */
function releaseNotesFor(releases: GitHubRelease[], tag: string): string | null {
  const body = releases.find((release) => release.tag_name === tag)?.body;
  if (typeof body !== "string" || !body.trim()) return null;
  return body.trim().slice(0, RELEASE_NOTES_MAX_CHARS);
}

function initialSnapshot(): UpdateCheckSnapshot {
  return {
    status: "pending",
    available: null,
    currentVersion: APP_VERSION,
    latestVersion: null,
    releaseUrl: null,
    releaseNotes: null,
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
        const latest = selectLatestRelease(releases, updateTrack());
        const current = parseSemver(APP_VERSION);
        if (!current) throw new Error("FamilyFi version is not valid SemVer.");
        const checkedAt = now().toISOString();
        snapshot = {
          status: "ok",
          available: latest ? compareSemver(parseSemver(latest.version)!, current) > 0 : false,
          currentVersion: APP_VERSION,
          latestVersion: latest?.version ?? null,
          releaseUrl: latest ? `${GITHUB_RELEASE_PAGE_URL}/${encodeURIComponent(latest.tag)}` : null,
          releaseNotes: latest ? releaseNotesFor(releases, latest.tag) : null,
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
          releaseNotes: null,
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
        unrefTimer(timer);
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
