export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type Schedule = {
  enabled: boolean;
  days: number[];
  start: string;
  end: string;
};

export type Suspension = {
  active: boolean;
  until: Date | null;
};

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseHm(value: string): { hour: number; minute: number } {
  const match = TIME.exec(value);
  if (!match) throw new Error("Times must be HH:MM in 24-hour form.");
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function assertSchedule(schedule: Schedule): void {
  parseHm(schedule.start);
  parseHm(schedule.end);
  if (schedule.start === schedule.end) {
    throw new Error("Schedule start and end cannot be the same time.");
  }
  if (schedule.enabled && schedule.days.length === 0) {
    throw new Error("An enabled schedule needs at least one day.");
  }
  if (schedule.days.some((day) => day < 0 || day > 6 || !Number.isInteger(day))) {
    throw new Error("Schedule days must be integers 0 (Sunday) through 6 (Saturday).");
  }
}

function localParts(now: Date, timezone: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekdayName = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const weekday = WEEKDAYS.indexOf(weekdayName as (typeof WEEKDAYS)[number]);
  if (weekday < 0 || Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error(`Cannot evaluate local time in ${timezone}.`);
  }
  return { weekday, minutes: hour * 60 + minute };
}

function minutesSinceMidnight(value: string): number {
  const { hour, minute } = parseHm(value);
  return hour * 60 + minute;
}

export function inRecurringWindow(now: Date, schedule: Schedule, timezone: string): boolean {
  if (!schedule.enabled) return false;
  assertSchedule(schedule);
  const { weekday, minutes } = localParts(now, timezone);
  const start = minutesSinceMidnight(schedule.start);
  const end = minutesSinceMidnight(schedule.end);
  if (start < end) {
    return schedule.days.includes(weekday) && minutes >= start && minutes < end;
  }
  if (schedule.days.includes(weekday) && minutes >= start) return true;
  const previous = (weekday + 6) % 7;
  return schedule.days.includes(previous) && minutes < end;
}

export function isSuspended(suspension: Suspension, now: Date): boolean {
  return suspension.active && (suspension.until === null || now < suspension.until);
}

export function isDesiredBlocked(input: {
  protected: boolean;
  schedule: Schedule;
  suspension: Suspension;
  now: Date;
  timezone: string;
}): boolean {
  // UI/API desired state. UniFi enforces the recurring window via policy schedule;
  // Pause is policy enabled=false, not this function flipping a flag at bedtime edges.
  if (input.protected) return false;
  if (isSuspended(input.suspension, input.now)) return false;
  return inRecurringWindow(input.now, input.schedule, input.timezone);
}

export function extendSuspensionUntil(
  existingUntil: Date | null,
  now: Date,
  addMs: number,
): Date {
  const base = existingUntil && existingUntil.getTime() > now.getTime() ? existingUntil : now;
  return new Date(base.getTime() + addMs);
}
