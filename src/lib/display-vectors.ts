/**
 * Runs `tests/fixtures/display-vectors.json` against the display logic: one runner per function,
 * the modules whose every export needs a vector, and one vector's replay. familyfi's unit test and
 * the Expo app (in Node and on device, where the JavaScript engine's Intl differs) share it.
 */
import * as groupActionsModule from "./group-actions";
import * as display from "./display";
import * as pauseSheet from "./pause-sheet";
import * as ruleActions from "./rule-actions";
import * as ruleWindows from "./rule-windows";
import type { Rule } from "./rules";
import type { Group } from "./types";

export type Vector = { fn: string; name: string; input: Record<string, unknown>; expected: unknown };
export type VectorFile = { version: number; vectors: Vector[] };

/* Every argument arrives as plain JSON, so each runner names its inputs and rebuilds instants. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each runner reads the fields its function takes
type Input = Record<string, any>;
const at = (value: string) => new Date(value);
const iso = (value: Date | null) => (value === null ? null : value.toISOString());

export const RUNNERS: Record<string, (input: Input) => unknown> = {
  accessLabel: (i) => display.accessLabel(i.access),
  accessColor: (i) => display.accessColor(i.access),
  minutesFromHhmm: (i) => display.minutesFromHhmm(i.value),
  localNowPercent: (i) => display.localNowPercent(i.timeZone, at(i.now)),
  roleLabel: (i) => display.roleLabel(i.role),
  roleTag: (i) => display.roleTag(i.group),
  initials: (i) => display.initials(i.name),
  deviceKindLabel: (i) => display.deviceKindLabel(i.hostname),
  deviceIcon: (i) => display.deviceIcon(i.hostname),
  formatHhmm: (i) => display.formatHhmm(i.value),
  formatClock: (i) => display.formatClock(at(i.date), i.timeZone),
  daysLabel: (i) => display.daysLabel(i.days),
  windowTimes: (i) => display.windowTimes(i.start, i.end),
  cardNoteLine: (i) => display.cardNoteLine(i.group, i.windows),
  cardStateLabel: (i) => display.cardStateLabel(i.group, i.windows, i.timeZone, at(i.now)),
  bedtimeEndDays: (i) => display.bedtimeEndDays(i.days, i.start, i.end),
  nextClockOnDays: (i) => iso(display.nextClockOnDays(i.timeZone, i.days, i.hhmm, at(i.now))),
  relativeDayLabel: (i) => display.relativeDayLabel(at(i.instant), i.timeZone, at(i.now)),
  groupActionSpecs: (i) => groupActionsModule.groupActionSpecs(i.group as Group, i.surface),
  pauseSheetTitle: (i) => pauseSheet.pauseSheetTitle(i.group, i.mode),
  pauseSheetBody: (i) => pauseSheet.pauseSheetBody(i.group, i.mode, i.deviceNames),
  pauseSheetOptions: (i) => pauseSheet.pauseSheetOptions(i.group, i.windows, i.mode, i.timeZone, at(i.now)),
  rulePauseSheetTitle: (i) => pauseSheet.rulePauseSheetTitle(i.rule, i.mode),
  rulePauseSheetBody: (i) => pauseSheet.rulePauseSheetBody(i.rule, i.mode),
  rulePauseSheetOptions: (i) => pauseSheet.rulePauseSheetOptions(i.rule, i.windows, i.mode, i.timeZone, at(i.now)),
  ruleActionSpecs: (i) => ruleActions.ruleActionSpecs(i.rule as Rule, i.timeZone, at(i.now)),
  ruleStateLine: (i) => ruleActions.ruleStateLine(i.rule, i.timeZone, at(i.now)),
  ruleGroupStateLines: (i) => ruleActions.ruleGroupStateLines(i.rule, i.groupNames, i.timeZone, at(i.now)),
  windowTitle: (i) => ruleWindows.windowTitle(i.window),
  isWindowActive: (i) => ruleWindows.isWindowActive(i.window, at(i.now), i.timeZone),
  windowEndsAt: (i) => iso(ruleWindows.windowEndsAt(i.window, at(i.now), i.timeZone)),
  nextWindowStart: (i) => iso(ruleWindows.nextWindowStart(i.window, at(i.now), i.timeZone)),
  windowDayBands: (i) => ruleWindows.windowDayBands(i.window, i.weekday),
  windowOverlaps: (i) => ruleWindows.windowOverlaps(i.windows),
  internetState: (i) => ruleWindows.internetState(i.group, i.windows, at(i.now), i.timeZone),
  internetDayBands: (i) => ruleWindows.internetDayBands(i.group, i.windows, at(i.now), i.timeZone),
  localWeekday: (i) => ruleWindows.localWeekday(at(i.now), i.timeZone),
};

/** The modules whose every exported function must have a vector, or a reason in `EXCLUDED`. */
export const MODULES = { display, groupActions: groupActionsModule, pauseSheet, ruleActions, ruleWindows };

/** Exported functions with no vector, each with the reason. */
export const EXCLUDED: Record<string, string> = {
  internetRulePath: "an API path, not display text",
};

export type Outcome =
  | { status: "pass"; vector: Vector }
  | { status: "skip"; vector: Vector; reason: string }
  | { status: "fail"; vector: Vector; actual: unknown };

/**
 * Runs one vector. `skip` names a vector a platform does not compare (a native client maps
 * `--ff-*` colours to its own tokens), or returns null. A JSON round trip drops undefined fields,
 * as the fixture's readers see them.
 */
export function replay(vector: Vector, skip: (vector: Vector) => string | null = () => null): Outcome {
  const reason = skip(vector);
  if (reason) return { status: "skip", vector, reason };
  const run = RUNNERS[vector.fn];
  if (!run) return { status: "fail", vector, actual: `no runner for ${vector.fn}` };
  let actual: unknown;
  try {
    const raw = run(vector.input);
    actual = raw === undefined ? undefined : JSON.parse(JSON.stringify(raw));
  } catch (error) {
    return { status: "fail", vector, actual: `threw ${String(error)}` };
  }
  return deepEqual(actual, vector.expected) ? { status: "pass", vector } : { status: "fail", vector, actual };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => bKeys.includes(key) && deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
