import { assertSchedule, isSuspended, type Schedule, type Suspension } from "../schedule";
import type { UnifiFirewallSchedule, UnifiWeekday } from "./types";

const UNIFI_DAYS: UnifiWeekday[] = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];

/** Recurring bedtime for UniFi. `undefined` means always-on (quarantine) or no schedule. */
export function toUnifiSchedule(schedule: Schedule): UnifiFirewallSchedule | undefined {
  if (!schedule.enabled) return undefined;
  assertSchedule(schedule);
  const timeFilter = { startTime: schedule.start, stopTime: schedule.end };
  const uniqueDays = [...new Set(schedule.days)].sort((a, b) => a - b);
  if (uniqueDays.length === 7) {
    return { mode: "EVERY_DAY", timeFilter };
  }
  return {
    mode: "EVERY_WEEK",
    repeatOnDays: uniqueDays.map((day) => UNIFI_DAYS[day]!),
    timeFilter,
  };
}

export function unifiPolicyEnabled(input: {
  ownerScope: "group" | "quarantine";
  protected: boolean;
  suspension: Suspension;
  now: Date;
  quarantineEnforced?: boolean;
}): boolean {
  if (input.ownerScope === "quarantine") return input.quarantineEnforced !== false;
  if (input.protected) return false;
  return !isSuspended(input.suspension, input.now);
}
