import { formatClock, nextBedtimeResumeAt } from "./display";
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
 * and `tests/fixtures/display-vectors.json` can pin them.
 */

export function pauseSheetTitle(group: Pick<Group, "kind" | "name">, mode: PauseSheetMode): string {
  const word = group.kind === "family" ? "bedtime" : "schedule";
  return mode === "extend" ? `More time for ${group.name}?` : `Pause ${group.name}’s ${word}?`;
}

export function pauseSheetBody(mode: PauseSheetMode): string {
  return mode === "extend"
    ? "Extending keeps the schedule suspended longer. Resume restores bedtime, which may still block."
    : "Pause suspends bedtime enforcement so internet is available from FamilyFi. Resume restores the stored schedule, which may still block during bedtime.";
}

export function pauseSheetOptions(
  group: Pick<Group, "schedule" | "suspension">,
  mode: PauseSheetMode,
  timezone: string,
  now: Date,
): PauseSheetOption[] {
  const bedtimeAt = nextBedtimeResumeAt(group, timezone, now);
  // Extend adds to a timed pause; an open-ended one has nothing to add to, so it re-pauses.
  const extending = mode === "extend" && group.suspension.active && Boolean(group.suspension.until);
  const timed = (label: string, minutes: number): PauseSheetOption => ({
    label,
    note: `schedule back at ${formatClock(new Date(now.getTime() + minutes * 60_000), timezone)}`,
    request: extending ? { kind: "extend", minutes } : { kind: "pauseFor", minutes },
  });
  return [
    timed("For 30 minutes", 30),
    timed("For an hour", 60),
    ...(bedtimeAt
      ? [
          {
            label: "Until bedtime ends",
            note: `schedule back at ${formatClock(bedtimeAt, timezone)}`,
            request: { kind: "pauseUntil", until: bedtimeAt.toISOString() } as const,
          },
        ]
      : []),
    { label: "Until I resume", note: "no end time", request: { kind: "pauseUntil", until: null } },
  ];
}
