import { pauseSheetBody, pauseSheetOptions, pauseSheetTitle, type PauseSheetMode } from "./pause-sheet";
import { internetWindowsForGroup, type Rule } from "./rules";
import type { Device, Group } from "./types";

/**
 * A group's pause or extend sheet as every client shows it: its title, the body naming the
 * group's devices, and the choices, from the group's internet windows now.
 */
export function groupPauseSheet(
  group: Group,
  rules: Rule[],
  devices: Pick<Device, "groupId" | "hostname">[],
  mode: PauseSheetMode,
  timezone: string,
  now: Date,
) {
  const deviceNames = devices.filter((device) => device.groupId === group.id).map((device) => device.hostname ?? "");
  return {
    title: pauseSheetTitle(group, mode),
    body: pauseSheetBody(group, mode, deviceNames),
    options: pauseSheetOptions(group, internetWindowsForGroup(rules, group.id, now), mode, timezone, now),
  };
}
