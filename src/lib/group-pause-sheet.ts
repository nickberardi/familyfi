import { groupRulePause, groupUnblock, rulesBlockingGroup } from "./group-actions";
import {
  groupRuleSheetBody,
  groupRuleSheetTitle,
  pauseSheetBody,
  pauseSheetCustom,
  pauseSheetOptions,
  pauseSheetTitle,
  rulePauseSheetCustom,
  rulePauseSheetOptions,
  unblockSheetBody,
  unblockSheetCustom,
  unblockSheetOptions,
  unblockSheetTitle,
  withCustomChoices,
  type CustomPause,
  type PauseSheetMode,
  type PauseSheetOption,
} from "./pause-sheet";
import { internetWindowsForGroup, ruleInternetWindows, type Rule } from "./rules";
import type { Device, Group } from "./types";

/**
 * Which sheet a group card opens: its block (all internet off), its unblock, or a pause of one of
 * its rule areas for it alone (`ruleIds`, called `name` in the copy). Each comes in `pause` (the
 * first time) and `extend` (More time).
 */
export type GroupSheetTarget =
  | { kind: "block"; mode: PauseSheetMode }
  | { kind: "unblock"; mode: PauseSheetMode }
  | { kind: "rule"; ruleIds: string[]; name: string; mode: PauseSheetMode };

/**
 * A group sheet as every client shows it: its title and body, the choices from the group's rules
 * now, and the picker's button (`confirm`). `choices` adds the device's last custom choice
 * (`recent`) and For… and Until…; `custom` turns a picked time into the option to apply, at the
 * moment of the tap (`at`) so a sheet left open never sends an end already passed.
 */
export function groupSheet(
  group: Group,
  rules: Rule[],
  devices: Pick<Device, "groupId" | "hostname">[],
  target: GroupSheetTarget,
  timezone: string,
  now: Date,
  recent: CustomPause | null = null,
) {
  const { mode } = target;
  const confirm = mode === "extend" ? "Add time" : target.kind === "block" ? "Block" : target.kind === "unblock" ? "Unblock" : "Pause";
  let sheet: { title: string; body: string; options: PauseSheetOption[]; custom: (custom: CustomPause, at?: Date) => PauseSheetOption | null };
  if (target.kind === "block") {
    const deviceNames = devices.filter((device) => device.groupId === group.id).map((device) => device.hostname ?? "");
    sheet = {
      title: pauseSheetTitle(group, mode),
      body: pauseSheetBody(group, mode, deviceNames),
      options: pauseSheetOptions(group, internetWindowsForGroup(rules, group.id, now), mode, timezone, now),
      custom: (custom, at = now) => pauseSheetCustom(group, custom, mode, timezone, at),
    };
  } else if (target.kind === "unblock") {
    const unblock = groupUnblock(group, rules, now);
    const blocking = rulesBlockingGroup(group, rules, timezone, now);
    sheet = {
      title: unblockSheetTitle(group, mode),
      body: unblockSheetBody(group, blocking, mode),
      options: unblockSheetOptions(unblock, blocking, mode, timezone, now),
      custom: (custom, at = now) => unblockSheetCustom(unblock, custom, mode, timezone, at),
    };
  } else {
    const zone = rules.filter((rule) => target.ruleIds.includes(rule.id));
    const paused = groupRulePause(group, zone, now);
    const pause = { active: Boolean(paused), until: paused?.until ?? null, kind: "pause" as const, by: paused?.by ?? null };
    sheet = {
      title: groupRuleSheetTitle(group, target.name, mode),
      body: groupRuleSheetBody(group, target.name, mode),
      options: rulePauseSheetOptions({ pause }, zone.flatMap(ruleInternetWindows), mode, timezone, now),
      custom: (custom, at = now) => rulePauseSheetCustom({ pause }, custom, mode, timezone, at),
    };
  }
  return { ...sheet, confirm, choices: withCustomChoices(sheet.options, recent && sheet.custom(recent)) };
}

/** A group's block or More time sheet (`groupSheet` with `{ kind: "block" }`). */
export function groupPauseSheet(
  group: Group,
  rules: Rule[],
  devices: Pick<Device, "groupId" | "hostname">[],
  mode: PauseSheetMode,
  timezone: string,
  now: Date,
  recent: CustomPause | null = null,
) {
  return groupSheet(group, rules, devices, { kind: "block", mode }, timezone, now, recent);
}
