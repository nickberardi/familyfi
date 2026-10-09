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

/** Days and a household-local time, as the day and time pickers set them. */
export type WeeklySchedule = { days: number[]; time: string };

export const DEFAULT_WEEKLY_CRON = "0 0 * * 0";

const WEEKLY_CRON = /^(\d{1,2}) (\d{1,2}) \* \* ([0-6](?:,[0-6])*)$/;

/**
 * A weekly schedule as cron, `minute hour * * days` (0 is Sunday), sorted and without repeats. At
 * least one day, since cron has no way to say none.
 */
export function weeklyCron({ days, time }: WeeklySchedule): string {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  const unique = [...new Set(days)].sort((left, right) => left - right);
  if (!match || unique.length === 0 || unique.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new Error("A weekly schedule needs an HH:MM time and at least one day from 0 (Sunday) to 6.");
  }
  return `${Number(match[2])} ${Number(match[1])} * * ${unique.join(",")}`;
}

/**
 * Reads cron that `weeklyCron` writes, and only that: a minute, an hour, any day of the month and
 * month, and a list of weekdays. Anything else is the default, Sunday at midnight, so a hand-edited
 * row cannot stop the schedule.
 */
export function parseWeeklyCron(cron: string): WeeklySchedule {
  const match = WEEKLY_CRON.exec(cron.trim());
  const minute = Number(match?.[1]);
  const hour = Number(match?.[2]);
  if (!match || minute > 59 || hour > 23) return { days: [...DEFAULT_WEEKLY_DAYS], time: DEFAULT_WEEKLY_TIME };
  const days = [...new Set(match[3]!.split(",").map(Number))].sort((left, right) => left - right);
  return { days, time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
}
