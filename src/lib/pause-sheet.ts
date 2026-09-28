import { formatClock } from "./display";
import { nextWindowStart, windowEndsAt, windowTitle, type InternetWindow } from "./rule-windows";
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

export function pauseSheetOptions(
  group: Pick<Group, "suspension">,
  windows: InternetWindow[],
  mode: PauseSheetMode,
  timezone: string,
  now: Date,
): PauseSheetOption[] {
  // Extend adds to a timed pause; an open-ended one has nothing to add to, so it re-pauses.
  const extending = mode === "extend" && group.suspension.active && Boolean(group.suspension.until);
  const timed = (label: string, minutes: number): PauseSheetOption => ({
    label,
    note: `back at ${formatClock(new Date(now.getTime() + minutes * 60_000), timezone)}`,
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
