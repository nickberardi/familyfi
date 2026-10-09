import type { UpdateRun as UpdateRunRow, UpdateRunStatus, UpdateTrigger } from "@prisma/client";
import { z } from "zod";
import type { UpdateRun, UpdateSettings } from "@/lib/types";
import { APP_VERSION } from "@/lib/version";
import { prisma } from "./db";
import { unrefTimer } from "./unref-timer";
import { compareSemver, parseSemver, refreshUpdateCheck, type UpdateCheckSnapshot } from "./update-check";
import { DEFAULT_WEEKLY_DAYS, DEFAULT_WEEKLY_TIME, dueWeeklyRunAt, nextWeeklyRunAt } from "./weekly-schedule";

/**
 * Installing a newer release through the Watchtower sidecar (docker/docker-compose.yml, profile
 * `updater`). FamilyFi never holds the Docker socket: it asks Watchtower to update the containers it
 * watches, which is the app alone, and reads Watchtower's history to learn what came of it. The
 * process that asked is usually the one being replaced, so every request is written down first and
 * settled by whichever process reads it next: the new release on its first start, or the old one
 * when Watchtower left it running.
 */
const DEFAULT_UPDATER_URL = "http://watchtower:8080";
const REQUEST_TIMEOUT_MS = 10_000;
/** Longer than the pre-update backup's timeout, an image pull and a migration together. */
export const UPDATE_RUN_TIMEOUT_MS = 30 * 60 * 1000;
/** A scheduled install missed by more than this (FamilyFi was down) waits for the next one. */
const SCHEDULE_CATCH_UP_MS = 60 * 60 * 1000;
/** Watchtower and FamilyFi share the host's clock, but a history entry is stamped after its scan began. */
const HISTORY_SKEW_MS = 5_000;

export type UpdaterSettings = { url: string; token: string };

/** The sidecar is set up when its token is: the same `FAMILYFI_UPDATER_TOKEN` is given to both containers. */
export function updaterSettings(source: Record<string, string | undefined> = process.env): UpdaterSettings | null {
  const token = source["FAMILYFI_UPDATER_TOKEN"]?.trim();
  if (!token) return null;
  const url = (source["FAMILYFI_UPDATER_URL"]?.trim() || DEFAULT_UPDATER_URL).replace(/\/+$/, "");
  return { url, token };
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

export function publicUpdateRun(row: UpdateRunRow): UpdateRun {
  return {
    id: row.id,
    trigger: row.trigger,
    fromVersion: row.fromVersion,
    targetVersion: row.targetVersion,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    error: row.error,
  };
}

/** Watchtower's `/v1/history`: one entry per finished scan, with counts of what happened to the containers it watches. */
const HistorySchema = z.object({
  entries: z
    .array(
      z.object({
        updated: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative(),
      }),
    )
    .nullable(),
});

export type WatchtowerHistory = { scans: number; updated: number; failed: number; skipped: number };

export type UpdateOutcome = { status: Exclude<UpdateRunStatus, "requested">; error: string | null } | null;

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
    const query = new URLSearchParams({ since: new Date(since.getTime() - HISTORY_SKEW_MS).toISOString() });
    const response = await watchtowerRequest(settings, `/v1/history?${query}`, { method: "GET" }, options.fetchImpl ?? fetch);
    if (!response.ok) return null;
    const parsed = HistorySchema.safeParse(await response.json());
    if (!parsed.success) return null;
    const entries = parsed.data.entries ?? [];
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

async function finishRun(id: string, status: Exclude<UpdateRunStatus, "requested">, error: string | null, now: Date) {
  // Only an open run is settled, so two processes settling the same run agree on the first outcome.
  await prisma().updateRun.updateMany({ where: { id, status: "requested" }, data: { status, error, finishedAt: now } });
  return prisma().updateRun.findUniqueOrThrow({ where: { id } });
}

/** Settles the open request, if there is one and its outcome is known. Returns it either way. */
export async function settleUpdateRun(options: UpdaterOptions = {}): Promise<UpdateRunRow | null> {
  const open = await prisma().updateRun.findFirst({ where: { status: "requested" }, orderBy: { requestedAt: "desc" } });
  if (!open) return null;
  const now = (options.now ?? (() => new Date()))();
  const currentVersion = options.currentVersion ?? APP_VERSION;
  const current = parseSemver(currentVersion);
  const target = parseSemver(open.targetVersion);
  const reached = current && target && compareSemver(current, target) >= 0;
  const history = reached ? null : await readHistory(open.requestedAt, options);
  const outcome = updateOutcome({ targetVersion: open.targetVersion, currentVersion, requestedAt: open.requestedAt, now, history });
  if (!outcome) return open;
  return finishRun(open.id, outcome.status, outcome.error, now);
}

/**
 * Asks Watchtower to install the release the update check found. The request is recorded before
 * Watchtower is called, inside the household row lock, so two installs at once cannot both start.
 */
export async function requestUpdate(
  input: { trigger: UpdateTrigger; accountId: string | null; update: UpdateCheckSnapshot },
  options: UpdaterOptions = {},
): Promise<UpdateRunRow> {
  const settings = options.settings === undefined ? updaterSettings() : options.settings;
  if (!settings) {
    throw new UpdaterError("updater_not_configured", "Automatic installs need the Watchtower sidecar and FAMILYFI_UPDATER_TOKEN.");
  }
  if (input.update.available !== true || !input.update.latestVersion) {
    throw new UpdaterError("no_update_available", "There is no newer release to install.");
  }
  const targetVersion = input.update.latestVersion;
  const now = (options.now ?? (() => new Date()))();
  await settleUpdateRun({ ...options, settings });
  const run = await prisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Household" WHERE "id" = 'default' FOR UPDATE`;
    const open = await tx.updateRun.findFirst({ where: { status: "requested" } });
    if (open) throw new UpdaterError("update_in_progress", `FamilyFi is already installing v${open.targetVersion}.`);
    return tx.updateRun.create({
      data: {
        trigger: input.trigger,
        fromVersion: options.currentVersion ?? APP_VERSION,
        targetVersion,
        requestedByAccountId: input.accountId,
        requestedAt: now,
      },
    });
  });
  let response: Response;
  try {
    // `async=true` answers 202 before Watchtower stops this container, so the reply always arrives.
    response = await watchtowerRequest(settings, "/v1/update?async=true", { method: "POST" }, options.fetchImpl ?? fetch);
  } catch {
    await finishRun(run.id, "failed", `Could not reach Watchtower at ${settings.url}.`, now);
    throw new UpdaterError("updater_unreachable", `Could not reach Watchtower at ${settings.url}.`);
  }
  if (response.status === 429) {
    await finishRun(run.id, "failed", "Watchtower was already updating containers.", now);
    throw new UpdaterError("update_in_progress", "Watchtower is already updating containers. Try again in a minute.");
  }
  if (!response.ok) {
    const message =
      response.status === 401 ? "Watchtower refused FAMILYFI_UPDATER_TOKEN." : `Watchtower answered HTTP ${response.status}.`;
    await finishRun(run.id, "failed", message, now);
    throw new UpdaterError("updater_unreachable", message);
  }
  return run;
}

export async function updateSettings(options: UpdaterOptions = {}): Promise<UpdateSettings> {
  const settings = options.settings === undefined ? updaterSettings() : options.settings;
  const household = await prisma().household.findUnique({
    where: { id: "default" },
    select: { timezone: true, autoUpdateEnabled: true, autoUpdateDays: true, autoUpdateTime: true },
  });
  const schedule = {
    enabled: household?.autoUpdateEnabled ?? true,
    days: household?.autoUpdateDays ?? DEFAULT_WEEKLY_DAYS,
    time: household?.autoUpdateTime ?? DEFAULT_WEEKLY_TIME,
  };
  await settleUpdateRun({ ...options, settings });
  const lastRun = await prisma().updateRun.findFirst({ orderBy: { requestedAt: "desc" } });
  const now = (options.now ?? (() => new Date()))();
  return {
    updater: { configured: settings !== null },
    schedule,
    nextRunAt:
      settings && schedule.enabled && schedule.days.length > 0
        ? nextWeeklyRunAt(now, household?.timezone ?? "America/New_York", schedule.time, schedule.days).toISOString()
        : null,
    lastRun: lastRun ? publicUpdateRun(lastRun) : null,
  };
}

let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Claims the currently due scheduled install and, if a newer release is out, requests it. The claim
 * (`autoUpdateLastRunAt`) is a conditional update, as for the DNS check, so a restart (including the
 * one the install itself causes) never installs twice for the same instant.
 */
async function claimAndInstallIfDue(options: UpdaterOptions = {}): Promise<boolean> {
  const settings = options.settings === undefined ? updaterSettings() : options.settings;
  if (!settings) return false;
  const household = await prisma().household.findUnique({
    where: { id: "default" },
    select: { timezone: true, autoUpdateEnabled: true, autoUpdateDays: true, autoUpdateTime: true },
  });
  if (!household?.autoUpdateEnabled || household.autoUpdateDays.length === 0) return false;
  const now = (options.now ?? (() => new Date()))();
  const due = dueWeeklyRunAt(now, household.timezone, household.autoUpdateTime, household.autoUpdateDays);
  if (now.getTime() - due.getTime() > SCHEDULE_CATCH_UP_MS) return false;
  const claimed = await prisma().household.updateMany({
    where: { id: "default", OR: [{ autoUpdateLastRunAt: null }, { autoUpdateLastRunAt: { lt: due } }] },
    data: { autoUpdateLastRunAt: due },
  });
  if (claimed.count === 0) return false;
  const update = await refreshUpdateCheck({ fetchImpl: options.fetchImpl });
  if (update.available !== true) return true;
  try {
    await requestUpdate({ trigger: "scheduled", accountId: null, update }, { ...options, settings });
  } catch (error) {
    // Recorded on the run where Watchtower was asked; an install already under way is not an error.
    if (!(error instanceof UpdaterError && error.code === "update_in_progress")) {
      console.error("Scheduled update did not start:", error instanceof Error ? error.message : error);
    }
  }
  return true;
}

async function arm(): Promise<void> {
  if (!updaterSettings()) return;
  const household = await prisma().household.findUnique({
    where: { id: "default" },
    select: { timezone: true, autoUpdateEnabled: true, autoUpdateDays: true, autoUpdateTime: true },
  });
  if (!household?.autoUpdateEnabled || household.autoUpdateDays.length === 0) return;
  const next = nextWeeklyRunAt(new Date(), household.timezone, household.autoUpdateTime, household.autoUpdateDays);
  timer = setTimeout(() => {
    void claimAndInstallIfDue()
      .catch((error) => console.error("Scheduled update failed:", error))
      .finally(() => void arm().catch(() => undefined));
  }, Math.max(0, next.getTime() - Date.now()));
  unrefTimer(timer);
}

function catchUpThenArm(): void {
  void claimAndInstallIfDue()
    .catch(() => {
      // The database may not be up yet; the next timer fire tries again.
    })
    .finally(() => {
      void arm().catch(() => {
        // As above: arming waits for the next start or schedule change.
      });
    });
}

/** Boot: settle a request the previous process made, catch up an install due within the hour, then arm the timer. */
export function startAutoUpdate(): void {
  if (timer) return;
  void settleUpdateRun().catch((error) => console.error("Could not settle the last update:", error));
  catchUpThenArm();
}

/**
 * Re-arms after the schedule changes. Unlike boot it never catches up: moving the time to one that
 * just passed should not replace FamilyFi as the administrator saves it.
 */
export function rescheduleAutoUpdate(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  void arm().catch((error) => console.error("Could not arm the update schedule:", error));
}

export function stopAutoUpdateForTests(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
}

export function runAutoUpdateCatchUpForTests(options: UpdaterOptions = {}): Promise<boolean> {
  return claimAndInstallIfDue(options);
}
