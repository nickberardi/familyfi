import { describe, expect, it } from "vitest";
import { TIMELINE_BAND_LOOK, bandTimes, timelineLegend, timelinePercent, timelineRank, type TimelineBand } from "@/lib/day-timeline";

const band = (patch: Partial<TimelineBand>): TimelineBand => ({ kind: "window", from: 0, to: 60, label: "Bedtime", source: "Bedtime rule", ...patch });

describe("day timeline", () => {
  it("places a band as a share of the day", () => {
    expect(timelinePercent(0)).toBe("0.000%");
    expect(timelinePercent(720)).toBe("50.000%");
    expect(timelinePercent(1440)).toBe("100.000%");
  });

  it("names a band's times, wrapping midnight", () => {
    expect(bandTimes({ from: 21 * 60 + 30, to: 1440 })).toBe("9:30 PM–12 AM");
    expect(bandTimes({ from: 15 * 60, to: 18 * 60 })).toBe("3 PM–6 PM");
  });

  it("draws allowances and pauses over the windows they change", () => {
    const kinds: TimelineBand["kind"][] = ["pause", "window", "faded", "allowance", "category"];
    expect([...kinds].sort((a, b) => timelineRank({ kind: a }) - timelineRank({ kind: b }))).toEqual([
      "faded",
      "category",
      "window",
      "allowance",
      "pause",
    ]);
  });

  it("joins last night's tail and tonight's start of one window into one legend entry", () => {
    const items = timelineLegend([band({ from: 0, to: 6 * 60 + 45 }), band({ from: 21 * 60 + 30, to: 1440 })]);
    expect(items).toEqual([{ kind: "window", label: "Bedtime", source: "Bedtime rule", times: "9:30 PM–6:45 AM" }]);
  });

  it("keeps two rules' like-named windows apart and leaves faded bands out", () => {
    const items = timelineLegend([
      band({ from: 15 * 60, to: 18 * 60, label: "Homework", source: "School days rule" }),
      band({ from: 16 * 60, to: 17 * 60, label: "Homework", source: "Tutoring rule" }),
      band({ kind: "faded", from: 0, to: 60 }),
    ]);
    expect(items.map((item) => `${item.label} ${item.times} (${item.source})`)).toEqual([
      "Homework 3 PM–6 PM (School days rule)",
      "Homework 4 PM–5 PM (Tutoring rule)",
    ]);
  });

  it("colours every band kind with a token name, never a CSS value", () => {
    for (const look of Object.values(TIMELINE_BAND_LOOK)) {
      expect(look.fill).toMatch(/^[a-z0-9-]+$/);
      if (look.line) expect(look.line).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
