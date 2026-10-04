/**
 * Clock times in the household's time zone: "HH:MM" parsing, formatting an instant as a clock time,
 * and finding the next time a clock reading falls on given days. Shared by the display logic and the
 * rule windows, which both import it rather than each other.
 */

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function minutesFromHhmm(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatClock(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function bedtimeEndDays(days: number[], start: string, end: string): number[] {
  const from = minutesFromHhmm(start);
  const to = minutesFromHhmm(end);
  if (from === null || to === null) return days;
  if (from < to) return days;
  return [...new Set(days.map((day) => (day + 1) % 7))];
}

export function nextClockOnDays(
  timezone: string,
  days: number[],
  hhmm: string,
  now: Date,
): Date | null {
  const minutes = minutesFromHhmm(hhmm);
  if (minutes === null || days.length === 0) return null;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const start = zonedParts(now, timezone);
  for (let offset = 0; offset < 8; offset++) {
    const wall = addCalendarDays(start.year, start.month, start.day, offset);
    const instant = zonedWallTimeToUtc(timezone, wall.year, wall.month, wall.day, hour, minute);
    const seen = zonedParts(instant, timezone);
    if (days.includes(seen.weekday) && instant.getTime() > now.getTime()) return instant;
  }
  return null;
}

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
};

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: WEEKDAYS.indexOf(get("weekday") as (typeof WEEKDAYS)[number]),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

export function addCalendarDays(year: number, month: number, day: number, offset: number) {
  const utc = new Date(Date.UTC(year, month - 1, day + offset));
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The instant the zone's clock reads the given time. The zone's offset is read on either
 * side of that time, so a day the clocks change is no different from any other. A time
 * that happens twice is its first occurrence; a time the clocks skip is read with the offset
 * from before the change, which moves it forward by the jump (02:30 becomes 03:30).
 */
export function zonedWallTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute, 0);
  const candidates = [wall - DAY_MS, wall, wall + DAY_MS].map((probe) => wall - (wallClock(probe, timeZone) - probe));
  const exact = candidates.filter((instant) => wallClock(instant, timeZone) === wall);
  // A skipped time: clocks skip forward, so the offset from before the change is the smallest and its reading the latest.
  return new Date(exact.length ? Math.min(...exact) : Math.max(...candidates));
}

/** The zone's clock reading at `instant`, as if that reading were UTC. */
function wallClock(instant: number, timeZone: string): number {
  const seen = zonedParts(new Date(instant), timeZone);
  return Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, 0);
}
