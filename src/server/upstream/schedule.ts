import { prisma } from "../db";
import { nextClockOnDays } from "@/lib/display";
import { probeEnabledCategories } from "./probe";
import { ResolverConfigError } from "./resolver-settings";
import { withUpstreamLock } from "./transaction";

/**
 * A household-local wall-clock schedule, not an interval from the last boot — the
 * earlier version read `dohProbeIntervalMinutes` once at start and re-armed a
 * `setInterval` of that length, so "daily" drifted with every restart and the setting
 * had no way to reach the UI anyway. This mirrors `scheduleStart`/`scheduleDays` on
 * `Group`, and reuses `nextClockOnDays` (`src/lib/display.ts`), the same DST-correct
 * function behind bedtime's `nextBedtimeResumeAt`, rather than writing new time math.
 */
export const DEFAULT_PROBE_TIME = "12:00";
export const DEFAULT_PROBE_DAYS = [0, 1, 2, 3, 4, 5, 6];

let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;

/**
 * The next scheduled instant strictly after `now`. Falls back to the default schedule
 * when the stored time is malformed or every day has been cleared — `nextClockOnDays`
 * returns `null` in both cases — and, failing even that, to 24 hours out, so a bad row
 * can never stop the loop rearming.
 */
export function nextProbeRunAt(now: Date, timezone: string, hhmm: string, days: number[]): Date {
  return (
    nextClockOnDays(timezone, days, hhmm, now) ??
    nextClockOnDays(timezone, DEFAULT_PROBE_DAYS, DEFAULT_PROBE_TIME, now) ??
    new Date(now.getTime() + 24 * 60 * 60 * 1000)
  );
}

/**
 * The most recent scheduled instant at or before `now` — the run that is currently
 * due. `nextClockOnDays` only ever returns an instant strictly after the time passed to
 * it, so this asks for the next occurrence after `now` minus a day, which lands on
 * today's occurrence once it has passed and yesterday's (or the last selected day's)
 * before that.
 */
export function dueProbeRunAt(now: Date, timezone: string, hhmm: string, days: number[]): Date {
  return nextProbeRunAt(new Date(now.getTime() - 24 * 60 * 60 * 1000), timezone, hhmm, days);
}

async function sweep(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const household = await prisma().household.findUnique({
      where: { id: "default" },
      select: { dohProbeEnabled: true },
    });
    if (!household?.dohProbeEnabled) return;
    await probeEnabledCategories();
  } catch (error) {
    // A sweep failure is already recorded per category as an unknown verdict; never
    // let it take the process down.
    if (!(error instanceof ResolverConfigError)) {
      console.error("upstream probe sweep failed", error);
    }
  } finally {
    running = false;
  }
}

/**
 * Claims the currently-due run and sweeps if it won the claim. Used both for the boot
 * catch-up and for every timer fire, so a missed run (a restart just after the
 * scheduled time) and an on-time run go through the same conditional update:
 *
 *   UPDATE Household SET dohProbeLastRunAt = due
 *   WHERE id = 'default' AND (dohProbeLastRunAt IS NULL OR dohProbeLastRunAt < due)
 *
 * No row updated means another process already accounted for this instant. This is the
 * whole of the cross-process guard — one deployment serves one household, so a claim
 * column inside the existing upstream lock is enough; it does not need a second
 * `ReconciliationLock`-style table. The DNS requests happen after the claim, outside
 * the lock, exactly as `recordCheck` already arranges for the write path.
 */
async function claimAndSweepIfDue(): Promise<boolean> {
  const now = new Date();
  const household = await prisma().household.findUnique({
    where: { id: "default" },
    select: {
      timezone: true,
      dohProbeTime: true,
      dohProbeDays: true,
      dohProbeEnabled: true,
      dohProbeLastRunAt: true,
    },
  });
  if (!household?.dohProbeEnabled) return false;
  const due = dueProbeRunAt(now, household.timezone, household.dohProbeTime, household.dohProbeDays);
  const claimed = await withUpstreamLock(async (tx) => {
    const result = await tx.household.updateMany({
      where: {
        id: "default",
        OR: [{ dohProbeLastRunAt: null }, { dohProbeLastRunAt: { lt: due } }],
      },
      data: { dohProbeLastRunAt: due },
    });
    return result.count > 0;
  });
  if (claimed) await sweep();
  return claimed;
}

async function arm(): Promise<void> {
  const household = await prisma().household.findUnique({
    where: { id: "default" },
    select: { timezone: true, dohProbeTime: true, dohProbeDays: true },
  });
  const next = nextProbeRunAt(
    new Date(),
    household?.timezone ?? "America/New_York",
    household?.dohProbeTime ?? DEFAULT_PROBE_TIME,
    household?.dohProbeDays ?? DEFAULT_PROBE_DAYS,
  );
  const delay = Math.max(0, next.getTime() - Date.now());
  timer = setTimeout(() => {
    void claimAndSweepIfDue().finally(() => void arm());
  }, delay);
  timer.unref?.();
}

/** Claims a missed run if one is due, then arms the timer for the next occurrence. */
function catchUpThenArm(): void {
  void claimAndSweepIfDue()
    .catch(() => {
      // Database may not be up yet; the caller's next attempt tries again.
    })
    .finally(() => {
      void arm().catch(() => {
        // Database may not be up yet; the caller's next attempt arms the loop.
      });
    });
}

/**
 * Boot: catch up a missed run — a restart shortly after the scheduled time still gets
 * that day's report — then arm the timer for the next occurrence. Does not sweep on
 * every boot; only when the currently-due instant has not already been claimed.
 */
export function startUpstreamProbe(): void {
  if (timer) return;
  catchUpThenArm();
}

/**
 * Re-reads settings and re-arms immediately, so a changed probe time, days,
 * `probeEnabled`, or timezone takes effect right away rather than at the next restart.
 * Also runs the same catch-up claim as boot: turning checking back on, or re-selecting
 * a day, after the scheduled time has already passed today should not wait until
 * tomorrow. Safe to call whether or not the loop has started.
 */
export function rescheduleUpstreamProbe(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  catchUpThenArm();
}

export function stopUpstreamProbeForTests(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  running = false;
}

/** Test entry point mirroring `runReconcileOnce()`: awaits the claim, returns whether it won. */
export function runProbeCatchUpForTests(): Promise<boolean> {
  return claimAndSweepIfDue();
}
