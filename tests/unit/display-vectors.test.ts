/**
 * `tests/fixtures/display-vectors.json` is the display behaviour the web app and the
 * native iOS app (nickberardi/familyfi-ios, `App/Display/*`) must both show: labels,
 * states, card actions and the pause sheet. iOS replays the same file against its port,
 * so this test runs every vector against the TypeScript and fails when either drifts.
 * Change display behaviour and the vectors change in the same pull request.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as groupActionsModule from "@/components/group-actions";
import * as display from "@/lib/display";
import * as pauseSheet from "@/lib/pause-sheet";
import type { Group } from "@/lib/types";

type Vector = { fn: string; name: string; input: Record<string, unknown>; expected: unknown };
const file = JSON.parse(
  readFileSync(path.resolve(__dirname, "../fixtures/display-vectors.json"), "utf8"),
) as { version: number; vectors: Vector[] };

/* Every argument arrives as plain JSON, so each runner names its inputs and rebuilds instants. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each runner reads the fields its function takes
type Input = Record<string, any>;
const at = (value: string) => new Date(value);
const iso = (value: Date | null) => (value === null ? null : value.toISOString());

const RUNNERS: Record<string, (input: Input) => unknown> = {
  accessLabel: (i) => display.accessLabel(i.access),
  accessColor: (i) => display.accessColor(i.access),
  minutesFromHhmm: (i) => display.minutesFromHhmm(i.value),
  scheduleBands: (i) => display.scheduleBands(i.start, i.end),
  localNowPercent: (i) => display.localNowPercent(i.timeZone, at(i.now)),
  roleLabel: (i) => display.roleLabel(i.role),
  roleTag: (i) => display.roleTag(i.group),
  initials: (i) => display.initials(i.name),
  deviceKindLabel: (i) => display.deviceKindLabel(i.hostname),
  deviceIcon: (i) => display.deviceIcon(i.hostname),
  formatHhmm: (i) => display.formatHhmm(i.value),
  formatClock: (i) => display.formatClock(at(i.date), i.timeZone),
  dayCaption: (i) => display.dayCaption(i.days),
  scheduleCaption: (i) => display.scheduleCaption(i.group),
  cardNoteLine: (i) => display.cardNoteLine(i.group),
  cardStateLabel: (i) => display.cardStateLabel(i.group, i.timeZone),
  canPauseGroup: (i) => display.canPauseGroup(i.group),
  bedtimeEndDays: (i) => display.bedtimeEndDays(i.days, i.start, i.end),
  nextClockOnDays: (i) => iso(display.nextClockOnDays(i.timeZone, i.days, i.hhmm, at(i.now))),
  nextBedtimeResumeAt: (i) => iso(display.nextBedtimeResumeAt(i.group, i.timeZone, at(i.now))),
  relativeDayLabel: (i) => display.relativeDayLabel(at(i.instant), i.timeZone, at(i.now)),
  groupActionSpecs: (i) => groupActionsModule.groupActionSpecs(i.group as Group, i.surface),
  pauseSheetTitle: (i) => pauseSheet.pauseSheetTitle(i.group, i.mode),
  pauseSheetBody: (i) => pauseSheet.pauseSheetBody(i.mode),
  pauseSheetOptions: (i) => pauseSheet.pauseSheetOptions(i.group, i.mode, i.timeZone, at(i.now)),
};

/**
 * Exports with no vector, each with the reason. Everything else a module exports must
 * have at least one, so a new display function cannot ship without telling iOS.
 */
const EXCLUDED: Record<string, string> = {
  // Wires `groupActionSpecs` to callbacks and the API client; the vectors pin the specs.
  groupActions: "binds React callbacks",
};

const MODULES = { display, groupActions: groupActionsModule, pauseSheet };

describe("display vectors", () => {
  it("is version 1 with unique names per function", () => {
    expect(file.version).toBe(1);
    const keys = file.vectors.map((vector) => `${vector.fn} / ${vector.name}`);
    expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual([]);
  });

  it("covers every exported function, or says why not", () => {
    const exported = Object.values(MODULES).flatMap((module) =>
      Object.entries(module)
        .filter(([, value]) => typeof value === "function")
        .map(([name]) => name),
    );
    const covered = new Set(file.vectors.map((vector) => vector.fn));
    expect(exported.filter((name) => !covered.has(name) && !(name in EXCLUDED))).toEqual([]);
    expect(Object.keys(EXCLUDED).filter((name) => !exported.includes(name))).toEqual([]);
    expect(Object.keys(RUNNERS).filter((name) => !exported.includes(name))).toEqual([]);
  });

  it.each(file.vectors.map((vector) => [`${vector.fn} / ${vector.name}`, vector] as const))("%s", (_, vector) => {
    const run = RUNNERS[vector.fn];
    expect(run, `no runner for ${vector.fn}`).toBeDefined();
    // A JSON round trip drops undefined fields, as the fixture and any other reader see them.
    expect(JSON.parse(JSON.stringify(run!(vector.input)))).toEqual(vector.expected);
  });
});
