import {
  pauseSheetBody,
  pauseSheetCustom,
  pauseSheetOptions,
  pauseSheetTitle,
  withCustomChoices,
  type CustomPause,
  type PauseSheetMode,
} from "./pause-sheet";
import { internetWindowsForGroup, type Rule } from "./rules";
import type { Device, Group } from "./types";

/**
 * A group's pause or extend sheet as every client shows it: its title, the body naming the
 * group's devices, and the choices, from the group's internet windows now. `choices` adds the
 * device's last custom choice (`recent`) and For… and Until…; `custom` turns a picked time into
 * the option to apply.
 */
export function groupPauseSheet(
  group: Group,
  rules: Rule[],
  devices: Pick<Device, "groupId" | "hostname">[],
  mode: PauseSheetMode,
  timezone: string,
  now: Date,
  recent: CustomPause | null = null,
) {
  const deviceNames = devices.filter((device) => device.groupId === group.id).map((device) => device.hostname ?? "");
  const options = pauseSheetOptions(group, internetWindowsForGroup(rules, group.id, now), mode, timezone, now);
  return {
    title: pauseSheetTitle(group, mode),
    body: pauseSheetBody(group, mode, deviceNames),
    options,
    choices: withCustomChoices(options, recent && pauseSheetCustom(group, recent, mode, timezone, now)),
    custom: (custom: CustomPause) => pauseSheetCustom(group, custom, mode, timezone, now),
  };
}
