import { describe, expect, it } from "vitest";
import {
  customPauseLabel,
  parseCustomPause,
  pauseSheetCustom,
  pauseSheetOptions,
  rulePauseSheetCustom,
  withCustomChoices,
} from "@/lib/pause-sheet";

const tz = "America/New_York";
// 12:00 PM in New York.
const now = new Date("2026-09-28T16:00:00Z");
const idle = { suspension: { active: false, until: null, by: null } };
// Paused until 3:00 PM New York.
const paused = { suspension: { active: true, until: "2026-09-28T19:00:00Z", by: null } };

describe("custom pause choices", () => {
  it("labels a duration or a time of day", () => {
    expect(customPauseLabel({ kind: "for", minutes: 180 })).toBe("For 3 hours");
    expect(customPauseLabel({ kind: "for", minutes: 60 })).toBe("For an hour");
    expect(customPauseLabel({ kind: "for", minutes: 90 })).toBe("For 1 hour 30 minutes");
    expect(customPauseLabel({ kind: "for", minutes: 45 })).toBe("For 45 minutes");
    expect(customPauseLabel({ kind: "until", clock: "21:00" })).toBe("Until 9:00 PM");
    expect(customPauseLabel({ kind: "until", clock: "00:05" })).toBe("Until 12:05 AM");
  });

  it("pauses a group for a duration from now, or until the next time the clock reads the time", () => {
    expect(pauseSheetCustom(idle, { kind: "for", minutes: 180 }, "pause", tz, now)).toEqual({
      label: "For 3 hours",
      note: "back at 3:00 PM",
      request: { kind: "pauseFor", minutes: 180 },
    });
    expect(pauseSheetCustom(idle, { kind: "until", clock: "21:00" }, "pause", tz, now)).toEqual({
      label: "Until 9:00 PM",
      note: "today",
      request: { kind: "pauseUntil", until: "2026-09-29T01:00:00.000Z" },
    });
    expect(pauseSheetCustom(idle, { kind: "until", clock: "08:00" }, "pause", tz, now)?.note).toBe("tomorrow");
  });

  it("extends from the pause's end, turning a time of day into the minutes after that end", () => {
    expect(pauseSheetCustom(paused, { kind: "for", minutes: 120 }, "extend", tz, now)).toEqual({
      label: "For 2 hours",
      note: "back at 5:00 PM",
      request: { kind: "extend", minutes: 120 },
    });
    expect(pauseSheetCustom(paused, { kind: "until", clock: "21:00" }, "extend", tz, now)?.request).toEqual({ kind: "extend", minutes: 360 });
    // A time already passed by the pause's end is that time tomorrow.
    expect(pauseSheetCustom(paused, { kind: "until", clock: "14:00" }, "extend", tz, now)).toMatchObject({
      note: "tomorrow",
      request: { kind: "extend", minutes: 23 * 60 },
    });
  });

  it("re-pauses an open-ended pause rather than extending it", () => {
    const open = { suspension: { active: true, until: null, by: null } };
    expect(pauseSheetCustom(open, { kind: "for", minutes: 30 }, "extend", tz, now)?.request).toEqual({ kind: "pauseFor", minutes: 30 });
  });

  it("says when a rule blocks again", () => {
    const rule = { pause: { active: false, until: null, kind: null, by: null } } as unknown as Parameters<typeof rulePauseSheetCustom>[0];
    expect(rulePauseSheetCustom(rule, { kind: "for", minutes: 30 }, "pause", tz, now)?.note).toBe("blocks again at 12:30 PM");
  });

  it("offers the last custom choice first and the pickers after the timed options", () => {
    const options = pauseSheetOptions(idle, [], "pause", tz, now);
    const recent = pauseSheetCustom(idle, { kind: "for", minutes: 180 }, "pause", tz, now);
    expect(withCustomChoices(options, recent).map((choice) => choice.label)).toEqual([
      "For 3 hours",
      "For 30 minutes",
      "For an hour",
      "For…",
      "Until…",
      "Until I resume",
    ]);
    // A custom choice a quick option already offers is not repeated.
    const hour = pauseSheetCustom(idle, { kind: "for", minutes: 60 }, "pause", tz, now);
    expect(withCustomChoices(options, hour).map((choice) => choice.label)[0]).toBe("For 30 minutes");
    expect(withCustomChoices(options, null)).toHaveLength(5);
  });

  it("keeps a window's quick option with the others, ahead of the pickers", () => {
    const windows = [{ name: "Bedtime", ruleName: "Bedtime", days: [0, 1, 2, 3, 4, 5, 6], start: "21:00", end: "07:00" }];
    const options = pauseSheetOptions(idle, windows, "pause", tz, now);
    expect(withCustomChoices(options, null).map((choice) => choice.label)).toEqual([
      "For 30 minutes",
      "For an hour",
      "Until Bedtime ends",
      "For…",
      "Until…",
      "Until I resume",
    ]);
  });

  it("reads back only a choice it could have kept", () => {
    expect(parseCustomPause(JSON.stringify({ kind: "for", minutes: 180 }))).toEqual({ kind: "for", minutes: 180 });
    expect(parseCustomPause(JSON.stringify({ kind: "until", clock: "21:00" }))).toEqual({ kind: "until", clock: "21:00" });
    for (const stored of [null, "", "not json", "null", '{"kind":"for","minutes":0}', '{"kind":"for","minutes":1.5}', '{"kind":"for","minutes":1441}', '{"kind":"until","clock":"25:00"}', '{"kind":"until","clock":"9:00"}', '{"kind":"later"}']) {
      expect(parseCustomPause(stored)).toBeNull();
    }
  });
});
