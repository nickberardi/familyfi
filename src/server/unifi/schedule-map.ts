import { assertSchedule, type Schedule } from "@/lib/schedule";
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

/** A rule window as a UniFi policy schedule. `undefined` means no schedule: the policy always applies. */
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
