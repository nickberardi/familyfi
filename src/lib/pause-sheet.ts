import { formatClock } from "./display";
import { isWindowActive, nextWindowStart, windowEndsAt, windowTitle, type InternetWindow } from "./rule-windows";
import type { Rule } from "./rules";
import type { Group } from "./types";

export type PauseSheetMode = "pause" | "extend";

/**
 * What an option does when tapped. `pauseFor` is resolved against the clock at the
 * tap, not when the sheet opened, so a sheet left open still pauses for the full time.
 */
export type PauseSheetRequest =
  | { kind: "pauseFor"; minutes: number }
  | { kind: "pauseUntil"; until: string | null }
  | { kind: "extend"; minutes: number };

export type PauseSheetOption = { label: string; note: string; request: PauseSheetRequest };

/*
 * The pause sheet's copy and options as plain data, so the native iOS app can port them
 * and `tests/fixtures/display-vectors.json` can pin them. A pause blocks all internet on
 * every device in the group, so the copy names that scope and the devices.
 */

export function pauseSheetTitle(group: Pick<Group, "name">, mode: PauseSheetMode): string {
  return mode === "extend" ? `Keep all internet off for ${group.name} longer?` : `Pause all internet for ${group.name}?`;
}

/** `deviceNames` are the group's devices' known names; the first one names the devices. */
export function pauseSheetBody(group: Pick<Group, "kind" | "deviceCount">, mode: PauseSheetMode, deviceNames: string[] = []): string {
  if (mode === "extend") return "Every device stays offline for longer. Resume brings internet back sooner.";
  const named = deviceNames.find((name) => name.trim())?.trim();
  const others = group.deviceCount - 1;
  const devices = named
    ? others > 0
      ? `${named} and ${others} other ${others === 1 ? "device" : "devices"} lose`
      : `${named} loses`
    : group.deviceCount === 1
      ? "Its 1 device loses"
      : group.deviceCount === 0
        ? "Devices you assign lose"
        : `All ${group.deviceCount} of its devices lose`;
  const outside = group.kind === "family" ? "Cellular data is not affected." : "The local network still works.";
  return `${devices} all internet. Category, app and website rules stay as they are. ${outside}`;
}

/**
 * Where a timed choice counts from: extending adds to the pause's end while it is still ahead, as
 * the server does (`extendSuspensionUntil` in `schedule.ts`); anything else starts now.
 */
function extendFrom(until: string | null, now: Date): number {
  const end = until ? Date.parse(until) : NaN;
  return end > now.getTime() ? end : now.getTime();
}

export function pauseSheetOptions(
  group: Pick<Group, "suspension">,
  windows: InternetWindow[],
  mode: PauseSheetMode,
  timezone: string,
  now: Date,
): PauseSheetOption[] {
  // Extend adds to a timed pause; an open-ended one has nothing to add to, so it re-pauses.
  const extending = mode === "extend" && group.suspension.active && Boolean(group.suspension.until);
  const from = extendFrom(extending ? group.suspension.until : null, now);
  const timed = (label: string, minutes: number): PauseSheetOption => ({
    label,
    note: `back at ${formatClock(new Date(from + minutes * 60_000), timezone)}`,
    request: extending ? { kind: "extend", minutes } : { kind: "pauseFor", minutes },
  });
  // Straight into the next internet window: offline until that window ends.
  const next = windows
    .map((window) => ({ window, start: nextWindowStart(window, now, timezone) }))
    .filter((item): item is { window: InternetWindow; start: Date } => item.start !== null)
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0];
  const nextEnd = next ? windowEndsAt(next.window, next.start, timezone) : null;
  return [
    timed("For 30 minutes", 30),
    timed("For an hour", 60),
    ...(next && nextEnd
      ? [
          {
            label: `Until ${windowTitle(next.window)} ends`,
            note: `back at ${formatClock(nextEnd, timezone)}`,
            request: { kind: "pauseUntil", until: nextEnd.toISOString() } as const,
          },
        ]
      : []),
    { label: "Until I resume", note: "no end time", request: { kind: "pauseUntil", until: null } },
  ];
}

/*
 * The same sheet for a rule. A rule pause lifts the rule for every group it covers, so the
 * copy says the rule stops blocking rather than that internet goes off.
 */

export function rulePauseSheetTitle(rule: Pick<Rule, "name">, mode: PauseSheetMode): string {
  return mode === "extend" ? `Keep ${rule.name} paused longer?` : `Pause ${rule.name}?`;
}

export function rulePauseSheetBody(rule: Pick<Rule, "groupIds" | "scope"> & Partial<Pick<Rule, "builtIn">>, mode: PauseSheetMode): string {
  if (mode === "extend") return "The rule stays lifted for longer. Resume brings it back sooner.";
  if (rule.builtIn === "quarantine") return "Unassigned devices can reach the internet until it ends. Rules and pauses on groups stay as they are.";
  const covered =
    rule.scope === "network"
      ? "everything on its networks"
      : rule.groupIds.length === 1
        ? "the group it covers"
        : `all ${rule.groupIds.length} groups it covers`;
  return `The rule stops blocking for ${covered}. Other rules, and any pause on a group, stay as they are.`;
}

export function rulePauseSheetOptions(
  rule: Pick<Rule, "pause">,
  windows: InternetWindow[],
  mode: PauseSheetMode,
  timezone: string,
  now: Date,
): PauseSheetOption[] {
  const extending = mode === "extend" && rule.pause.active && Boolean(rule.pause.until);
  const from = extendFrom(extending ? rule.pause.until : null, now);
  const timed = (label: string, minutes: number): PauseSheetOption => ({
    label,
    note: `blocks again at ${formatClock(new Date(from + minutes * 60_000), timezone)}`,
    request: extending ? { kind: "extend", minutes } : { kind: "pauseFor", minutes },
  });
  // A window is blocking now: lift the rule until the last active one ends.
  const active = windows
    .filter((window) => isWindowActive(window, now, timezone))
    .map((window) => ({ window, end: windowEndsAt(window, now, timezone) }));
  const last = active.some((item) => item.end === null)
    ? null
    : active.reduce<(typeof active)[number] | null>((latest, item) => (!latest || item.end!.getTime() > latest.end!.getTime() ? item : latest), null);
  return [
    timed("For 30 minutes", 30),
    timed("For an hour", 60),
    ...(last
      ? [
          {
            label: `Until ${windowTitle(last.window)} ends`,
            note: `blocks again at ${formatClock(last.end!, timezone)}`,
            request: { kind: "pauseUntil", until: last.end!.toISOString() } as const,
          },
        ]
      : []),
    { label: "Until I resume", note: "no end time", request: { kind: "pauseUntil", until: null } },
  ];
}
