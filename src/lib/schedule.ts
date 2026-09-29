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

export function isSuspended(suspension: Suspension, now: Date): boolean {
  return suspension.active && (suspension.until === null || now < suspension.until);
}

export function extendSuspensionUntil(
  existingUntil: Date | null,
  now: Date,
  addMs: number,
): Date {
  const base = existingUntil && existingUntil.getTime() > now.getTime() ? existingUntil : now;
  return new Date(base.getTime() + addMs);
}
