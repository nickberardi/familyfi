import { nextClockOnDays } from "@/lib/display";

/**
 * A household-local wall-clock schedule, not an interval from the last boot — the
 * DNS check's earlier version read `dohProbeIntervalMinutes` once at start and re-armed a
 * `setInterval` of that length, so "daily" drifted with every restart and the setting
 * had no way to reach the UI anyway. The DNS check and automatic updates share it. It is
 * shaped like a rule window's start and days, and reuses `nextClockOnDays` (`src/lib/display.ts`), the same DST-correct function
 * behind a rule window's next start, rather than writing new time math.
 */
export const DEFAULT_WEEKLY_TIME = "00:00";
export const DEFAULT_WEEKLY_DAYS = [0];

/**
 * The next scheduled instant strictly after `now`. Falls back to the default schedule
 * when the stored time is malformed; callers skip scheduling when no day is selected.
 * Failing even the default, use 24 hours out so a bad row cannot stop the loop.
 */
export function nextWeeklyRunAt(now: Date, timezone: string, hhmm: string, days: number[]): Date {
  return (
    nextClockOnDays(timezone, days, hhmm, now) ??
    nextClockOnDays(timezone, DEFAULT_WEEKLY_DAYS, DEFAULT_WEEKLY_TIME, now) ??
    new Date(now.getTime() + 24 * 60 * 60 * 1000)
  );
}

/**
 * The most recent scheduled instant at or before `now` — the run that is currently
 * due. `nextClockOnDays` only ever returns an instant strictly after the time passed to
 * it, so scan from eight days back to include the preceding Sunday on a weekly schedule.
 */
export function dueWeeklyRunAt(now: Date, timezone: string, hhmm: string, days: number[]): Date {
  let cursor = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
  let due = nextWeeklyRunAt(cursor, timezone, hhmm, days);
  while (due.getTime() <= now.getTime()) {
    cursor = due;
    const next = nextWeeklyRunAt(cursor, timezone, hhmm, days);
    if (next.getTime() > now.getTime()) return due;
    due = next;
  }
  return due;
}
