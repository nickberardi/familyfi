import { readFileSync } from "node:fs";
import type { UpdateStatus } from "@prisma/client";
import { z } from "zod";
import type { UpdateRun, UpdateSettings } from "@/lib/types";
import { APP_VERSION } from "@/lib/version";
import { prisma } from "./db";
import { unrefTimer } from "./unref-timer";
import { compareSemver, parseSemver, refreshUpdateCheck, type UpdateCheckSnapshot } from "./update-check";
import { dueWeeklyRunAt, nextWeeklyRunAt, parseWeeklyCron } from "./weekly-schedule";

/**
 * Installing a newer release through the Watchtower sidecar (docker/docker-compose.yml). FamilyFi
 * never holds the Docker socket: it asks Watchtower to update the containers it
 * watches, which is the app alone, and reads Watchtower's history to learn what came of it. The
 * process that asked is usually the one being replaced, so the request is written on the household
 * row first (`updateRequestedAt`, `updateTargetVersion`, `updateStatus`, `updateError`) and settled
 * by whichever process reads it next: the new release on its first start, or the old one when
 * Watchtower left it running. Only the latest install is kept.
 */
const DEFAULT_UPDATER_URL = "http://watchtower:8080";
const REQUEST_TIMEOUT_MS = 10_000;
/** Longer than the pre-update backup's timeout, an image pull and a migration together. */
export const UPDATE_RUN_TIMEOUT_MS = 30 * 60 * 1000;
/** A scheduled install missed by more than this (FamilyFi was down) waits for the next one. */
const SCHEDULE_CATCH_UP_MS = 60 * 60 * 1000;
/** How long an answer, or silence, from Watchtower stands for the Update page. */
const REACHABLE_CACHE_MS = 30_000;
const REACHABLE_TIMEOUT_MS = 3_000;

/** Where the entrypoint writes the token FamilyFi and Watchtower share (scripts/runtime/ensure-updater-token.mjs). */
const UPDATER_TOKEN_FILE = "/var/lib/familyfi/updater/token";
let tokenFile = UPDATER_TOKEN_FILE;

export function setUpdaterTokenFileForTests(path?: string) {
  tokenFile = path ?? UPDATER_TOKEN_FILE;
  reachable = undefined;
}

export type UpdaterSettings = { url: string; token: string };

/**
 * The token and where Watchtower answers, or null without a token: outside the release image, or
 * when the updater volume is not mounted. `FAMILYFI_UPDATER_URL` points at a Watchtower that is
 * not the Compose service.
 */
export function updaterSettings(source: Record<string, string | undefined> = process.env, file = tokenFile): UpdaterSettings | null {
  let token: string;
  try {
    token = readFileSync(file, "utf8").trim();
  } catch {
    return null;
  }
  if (!token) return null;
  const url = (source["FAMILYFI_UPDATER_URL"]?.trim() || DEFAULT_UPDATER_URL).replace(/\/+$/, "");
  return { url, token };
}

let reachable: { key: string; at: number; answer: Promise<boolean> } | undefined;

/** Watchtower is set up when it answers with this token; a token alone is in every image. */
export function watchtowerAnswers(settings: UpdaterSettings, options: UpdaterOptions = {}): Promise<boolean> {
  const now = (options.now ?? (() => new Date()))().getTime();
  const key = `${settings.url} ${settings.token}`;
  if (reachable && reachable.key === key && now - reachable.at < REACHABLE_CACHE_MS) return reachable.answer;
  const answer = (options.fetchImpl ?? fetch)(`${settings.url}/v1/history?limit=1`, {
    headers: { Authorization: `Bearer ${settings.token}` },
    signal: AbortSignal.timeout(REACHABLE_TIMEOUT_MS),
  }).then(
    (response) => response.ok,
    () => false,
  );
  reachable = { key, at: now, answer };
  return answer;
}

export type UpdaterErrorCode = "updater_not_configured" | "no_update_available" | "update_in_progress" | "updater_unreachable";

export class UpdaterError extends Error {
  constructor(
    readonly code: UpdaterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "UpdaterError";
  }
}

export type UpdaterOptions = {
  fetchImpl?: typeof fetch;
  settings?: UpdaterSettings | null;
  now?: () => Date;
  currentVersion?: string;
};

/** The latest install request, as the household row holds it. */
export type LatestUpdate = { requestedAt: Date; targetVersion: string; status: UpdateStatus; error: string | null };

type Db = Pick<ReturnType<typeof prisma>, "household">;

async function latestUpdate(db: Db = prisma()): Promise<LatestUpdate | null> {
  const row = await db.household.findUnique({
    where: { id: "default" },
    select: { updateRequestedAt: true, updateTargetVersion: true, updateStatus: true, updateError: true },
  });
  if (!row?.updateRequestedAt || !row.updateTargetVersion || !row.updateStatus) return null;
  return { requestedAt: row.updateRequestedAt, targetVersion: row.updateTargetVersion, status: row.updateStatus, error: row.updateError };
}

export function publicUpdateRun(latest: LatestUpdate): UpdateRun {
  return {
    targetVersion: latest.targetVersion,
    status: latest.status,
    requestedAt: latest.requestedAt.toISOString(),
    error: latest.error,
  };
}

/** Watchtower's `/v1/history`: one entry per finished scan, with counts of what happened to the containers it watches. */
const HistorySchema = z.object({
  entries: z
    .array(
      z.object({
        timestamp: z.iso.datetime({ offset: true }),
        updated: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative(),
      }),
    )
    .nullable(),
});

export type WatchtowerHistory = { scans: number; updated: number; failed: number; skipped: number };

export type UpdateOutcome = { status: Exclude<UpdateStatus, "requested">; error: string | null } | null;

/**
 * What an open request came to, or null while it is still under way. Pure, so each outcome is tested
 * directly: the release running now settles it first, then Watchtower's history since the request,
 * then the time limit. `history` is null when Watchtower could not be asked.
 */
export function updateOutcome(input: {
  targetVersion: string;
  currentVersion: string;
  requestedAt: Date;
  now: Date;
  history: WatchtowerHistory | null;
}): UpdateOutcome {
  const current = parseSemver(input.currentVersion);
  const target = parseSemver(input.targetVersion);
  if (current && target && compareSemver(current, target) >= 0) return { status: "succeeded", error: null };
  const history = input.history;
  if (history && history.scans > 0) {
    // A pre-update hook that exits 75 (the backup failed) is counted as failed, not skipped.
    if (history.failed > 0) {
      return {
        status: "failed",
        error: "Watchtower did not replace FamilyFi: the backup before installing failed, or the replacement did. The FamilyFi and Watchtower logs say which.",
      };
    }
    if (history.updated > 0) {
      return {
        status: "failed",
        error: `Watchtower replaced the container, but it runs v${input.currentVersion}, not v${input.targetVersion}.`,
      };
    }
    if (history.skipped > 0) {
      return {
        status: "skipped",
        error: "Watchtower skipped the update; its log says why.",
      };
    }
    return {
      status: "unchanged",
      error: "Watchtower found no newer image for the tag FamilyFi runs. If FAMILYFI_IMAGE pins a version, change it to install a newer one.",
    };
  }
  if (input.now.getTime() - input.requestedAt.getTime() > UPDATE_RUN_TIMEOUT_MS) {
    return { status: "failed", error: "Watchtower did not report a result within 30 minutes." };
  }
  return null;
}

function watchtowerRequest(settings: UpdaterSettings, path: string, init: RequestInit, fetchImpl: typeof fetch) {
  return fetchImpl(`${settings.url}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${settings.token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function readHistory(since: Date, options: UpdaterOptions): Promise<WatchtowerHistory | null> {
  const settings = options.settings === undefined ? updaterSettings() : options.settings;
  if (!settings) return null;
  try {
    const query = new URLSearchParams({ since: since.toISOString() });
    const response = await watchtowerRequest(settings, `/v1/history?${query}`, { method: "GET" }, options.fetchImpl ?? fetch);
    if (!response.ok) return null;
    const parsed = HistorySchema.safeParse(await response.json());
    if (!parsed.success) return null;
    // Only scans that ended after this request; one an earlier request ran must not settle it.
    const entries = (parsed.data.entries ?? []).filter((entry) => new Date(entry.timestamp).getTime() >= since.getTime());
    return entries.reduce<WatchtowerHistory>(
      (sum, entry) => ({
        scans: sum.scans + 1,
        updated: sum.updated + entry.updated,
        failed: sum.failed + entry.failed,
        skipped: sum.skipped + entry.skipped,
      }),
      { scans: 0, updated: 0, failed: 0, skipped: 0 },
    );
  } catch {
    // Unreachable while it restarts or is not running; the request stays open until the time limit.
    return null;
  }
}

async function finishRun(requestedAt: Date, status: Exclude<UpdateStatus, "requested">, error: string | null) {
  // Only the open request made at that instant is settled, so two processes settling it agree on the
  // first outcome, and a newer request is never settled with an older one's.
  await prisma().household.updateMany({
    where: { id: "default", updateStatus: "requested", updateRequestedAt: requestedAt },
    data: { updateStatus: status, updateError: error },
  });
  return latestUpdate();
}

/** Settles the open request, if there is one and its outcome is known. Returns the latest request either way. */
export async function settleUpdateRun(options: UpdaterOptions = {}): Promise<LatestUpdate | null> {
  const open = await latestUpdate();
  if (open?.status !== "requested") return open;
  const now = (options.now ?? (() => new Date()))();
  const currentVersion = options.currentVersion ?? APP_VERSION;
  const current = parseSemver(currentVersion);
  const target = parseSemver(open.targetVersion);
  const reached = current && target && compareSemver(current, target) >= 0;
  const history = reached ? null : await readHistory(open.requestedAt, options);
  const outcome = updateOutcome({ targetVersion: open.targetVersion, currentVersion, requestedAt: open.requestedAt, now, history });
  if (!outcome) return open;
  return finishRun(open.requestedAt, outcome.status, outcome.error);
}

/**
 * Asks Watchtower to install the release the update check found. The request is recorded before
 * Watchtower is called, inside the household row lock, so two installs at once cannot both start.
 */
export async function requestUpdate(
  input: { update: UpdateCheckSnapshot },
  options: UpdaterOptions = {},
): Promise<LatestUpdate> {
  const settings = options.settings === undefined ? updaterSettings() : options.settings;
  if (!settings) {
    throw new UpdaterError("updater_not_configured", "Installing needs the Watchtower updater beside FamilyFi, and this install has no updater token.");
  }
  if (input.update.available !== true || !input.update.latestVersion) {
    throw new UpdaterError("no_update_available", "There is no newer release to install.");
  }
  // Every image has a token; the updater is there only when Watchtower answers to it.
  if (!(await watchtowerAnswers(settings, options))) {
    throw new UpdaterError("updater_not_configured", `Installing needs the Watchtower updater beside FamilyFi, and nothing answers at ${settings.url}.`);
  }
  const targetVersion = input.update.latestVersion;
  const now = (options.now ?? (() => new Date()))();
  await settleUpdateRun({ ...options, settings });
  const run = await prisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Household" WHERE "id" = 'default' FOR UPDATE`;
    const open = await latestUpdate(tx);
    if (open?.status === "requested") throw new UpdaterError("update_in_progress", `FamilyFi is already installing v${open.targetVersion}.`);
    const requested: LatestUpdate = { requestedAt: now, targetVersion, status: "requested", error: null };
    await tx.household.update({
      where: { id: "default" },
      data: { updateRequestedAt: now, updateTargetVersion: targetVersion, updateStatus: "requested", updateError: null },
    });
    return requested;
  });
  let response: Response;
  try {
    // `async=true` answers 202 before Watchtower stops this container, so the reply always arrives.
    response = await watchtowerRequest(settings, "/v1/update?async=true", { method: "POST" }, options.fetchImpl ?? fetch);
  } catch {
    await finishRun(run.requestedAt, "failed", `Could not reach Watchtower at ${settings.url}.`);
    throw new UpdaterError("updater_unreachable", `Could not reach Watchtower at ${settings.url}.`);
  }
  if (response.status === 429) {
    await finishRun(run.requestedAt, "failed", "Watchtower was already updating containers.");
    throw new UpdaterError("update_in_progress", "Watchtower is already updating containers. Try again in a minute.");
  }
  if (!response.ok) {
    const message =
      response.status === 401 ? "Watchtower refused FamilyFi's updater token." : `Watchtower answered HTTP ${response.status}.`;
    await finishRun(run.requestedAt, "failed", message);
    throw new UpdaterError("updater_unreachable", message);
  }
  return run;
}

export async function updateSettings(options: UpdaterOptions = {}): Promise<UpdateSettings> {
  const settings = options.settings === undefined ? updaterSettings() : options.settings;
  const household = await prisma().household.findUnique({
    where: { id: "default" },
    select: { timezone: true, updateScheduleEnabled: true, updateSchedule: true },
  });
  const schedule = { enabled: household?.updateScheduleEnabled ?? true, ...parseWeeklyCron(household?.updateSchedule ?? "") };
  const lastRun = await settleUpdateRun({ ...options, settings });
  const now = (options.now ?? (() => new Date()))();
  const configured = settings !== null && (await watchtowerAnswers(settings, options));
  return {
    updater: { configured },
    schedule,
    nextRunAt:
      configured && schedule.enabled
        ? nextWeeklyRunAt(now, household?.timezone ?? "America/New_York", schedule.time, schedule.days).toISOString()
        : null,
    lastRun: lastRun ? publicUpdateRun(lastRun) : null,
  };
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Bumped by every re-arm, so an `arm` still reading the schedule when another starts never sets a timer. */
let generation = 0;
/** A failed release check is tried again this often while its slot is still due. */
const RETRY_MS = 15 * 60 * 1000;

type Claim = "installed" | "nothing" | "retry";

/**
 * Claims the currently due scheduled install and, if a newer release is out, requests it. The claim
 * (`updateScheduleLastRunAt`) is a conditional update, as for the DNS check, so a restart (including the
 * one the install itself causes) never installs twice for the same instant. The release check runs
 * first: when GitHub cannot be asked the slot is left unclaimed, to be tried again within the hour.
 */
async function claimAndInstallIfDue(options: UpdaterOptions = {}): Promise<Claim> {
  const settings = options.settings === undefined ? updaterSettings() : options.settings;
  if (!settings) return "nothing";
  const household = await prisma().household.findUnique({
    where: { id: "default" },
    select: { timezone: true, updateScheduleEnabled: true, updateSchedule: true, updateScheduleLastRunAt: true },
  });
  if (!household?.updateScheduleEnabled) return "nothing";
  const { days, time } = parseWeeklyCron(household.updateSchedule);
  const now = (options.now ?? (() => new Date()))();
  const due = dueWeeklyRunAt(now, household.timezone, time, days);
  if (now.getTime() - due.getTime() > SCHEDULE_CATCH_UP_MS) return "nothing";
  if (household.updateScheduleLastRunAt && household.updateScheduleLastRunAt.getTime() >= due.getTime()) return "nothing";
  const update = await refreshUpdateCheck({ fetchImpl: options.fetchImpl });
  if (update.status !== "ok") return "retry";
  // Without Watchtower (`docker compose up -d db app`) the schedule installs and records nothing. It
  // tries again within the hour: after a restart Watchtower starts only once FamilyFi has.
  if (!(await watchtowerAnswers(settings, options))) return "retry";
  const claimed = await prisma().household.updateMany({
    where: { id: "default", OR: [{ updateScheduleLastRunAt: null }, { updateScheduleLastRunAt: { lt: due } }] },
    data: { updateScheduleLastRunAt: due },
  });
  if (claimed.count === 0 || update.available !== true) return "nothing";
  try {
    await requestUpdate({ update }, { ...options, settings });
  } catch (error) {
    // Recorded on the household where Watchtower was asked; an install already under way is not an error.
    if (!(error instanceof UpdaterError && error.code === "update_in_progress")) {
      console.error("Scheduled update did not start:", error instanceof Error ? error.message : error);
    }
  }
  return "installed";
}

function setTimer(run: () => void, delay: number, armed: number) {
  if (armed !== generation) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(run, Math.max(0, delay));
  unrefTimer(timer);
}

/** Arms the next scheduled instant, or a retry when the last check could not be made. */
async function arm(armed: number, retry = false): Promise<void> {
  if (!updaterSettings()) return;
  const household = await prisma().household.findUnique({
    where: { id: "default" },
    select: { timezone: true, updateScheduleEnabled: true, updateSchedule: true },
  });
  if (!household?.updateScheduleEnabled) return;
  const { days, time } = parseWeeklyCron(household.updateSchedule);
  const next = retry ? new Date(Date.now() + RETRY_MS) : nextWeeklyRunAt(new Date(), household.timezone, time, days);
  setTimer(() => fire(armed), next.getTime() - Date.now(), armed);
}

function fire(armed: number) {
  void claimAndInstallIfDue()
    .catch((error): Claim => {
      // The database may not be up yet; the next instant, or the retry, tries again.
      console.error("Scheduled update failed:", error);
      return "nothing";
    })
    .then((claim) => arm(armed, claim === "retry"))
    .catch(() => undefined);
}

/** Boot: settle a request the previous process made, catch up an install due within the hour, then arm the timer. */
export function startAutoUpdate(): void {
  if (timer) return;
  void settleUpdateRun().catch((error) => console.error("Could not settle the last update:", error));
  fire(++generation);
}

/**
 * Re-arms after the schedule changes. Unlike boot it never catches up: moving the time to one that
 * just passed should not replace FamilyFi as the administrator saves it.
 */
export function rescheduleAutoUpdate(): void {
  const armed = ++generation;
  if (timer) clearTimeout(timer);
  timer = undefined;
  void arm(armed).catch((error) => console.error("Could not arm the update schedule:", error));
}

export function stopAutoUpdateForTests(): void {
  generation += 1;
  if (timer) clearTimeout(timer);
  timer = undefined;
}

/** Whether a scheduled install is armed, for tests. */
export function autoUpdateArmedForTests(): boolean {
  return timer !== undefined;
}

export function runAutoUpdateCatchUpForTests(options: UpdaterOptions = {}): Promise<Claim> {
  return claimAndInstallIfDue(options);
}
