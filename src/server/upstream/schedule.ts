import { prisma } from "../db";
import { DEFAULT_WEEKLY_DAYS, DEFAULT_WEEKLY_TIME, dueWeeklyRunAt, nextWeeklyRunAt } from "../weekly-schedule";
import { probeEnabledCategories } from "./probe";
import { ResolverConfigError } from "./resolver-settings";
import { withUpstreamLock } from "./transaction";
import { unrefTimer } from "../unref-timer";

let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;

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
  if (!household?.dohProbeEnabled || household.dohProbeDays.length === 0) return false;
  const due = dueWeeklyRunAt(now, household.timezone, household.dohProbeTime, household.dohProbeDays);
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
    select: { timezone: true, dohProbeTime: true, dohProbeDays: true, dohProbeEnabled: true },
  });
  if (!household?.dohProbeEnabled || household.dohProbeDays.length === 0) return;
  const next = nextWeeklyRunAt(
    new Date(),
    household?.timezone ?? "America/New_York",
    household?.dohProbeTime ?? DEFAULT_WEEKLY_TIME,
    household?.dohProbeDays ?? DEFAULT_WEEKLY_DAYS,
  );
  const delay = Math.max(0, next.getTime() - Date.now());
  timer = setTimeout(() => {
    void claimAndSweepIfDue().finally(() => void arm());
  }, delay);
  unrefTimer(timer);
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
