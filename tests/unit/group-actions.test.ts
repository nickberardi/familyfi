import { describe, expect, it, vi } from "vitest";
import { groupActions } from "@/components/group-actions";
import type { Group } from "@/lib/types";

function group(overrides: Partial<Group> = {}): Group {
  return {
    id: "g1",
    kind: "family",
    name: "Betsy",
    monogram: null,
    familyRole: "child",
    protected: false,
    mode: "scheduled",
    deviceCount: 4,
    schedule: { enabled: true, days: [1, 2, 3, 4, 5], start: "21:30", end: "06:45" },
    suspension: { active: false, until: null },
    access: "available",
    ...overrides,
  };
}

const mutate = vi.fn();
const openPause = vi.fn();
const openExtend = vi.fn();

describe("groupActions", () => {
  it("uses Pause, Bedtime, and Detail on the web parent card", () => {
    expect(groupActions(group(), "web", openPause, openExtend, mutate).map((item) => item.label)).toEqual([
      "Pause",
      "Bedtime",
      "Detail",
    ]);
  });

  it("omits Detail on the phone card because the row already navigates", () => {
    expect(groupActions(group(), "phone", openPause, openExtend, mutate).map((item) => item.label)).toEqual([
      "Pause",
      "Bedtime",
    ]);
  });

  it("caps a paused card at Resume, Extend, and Bedtime", () => {
    expect(
      groupActions(
        group({ suspension: { active: true, until: "2026-09-14T20:00:00.000Z" }, access: "paused" }),
        "web",
        openPause,
        openExtend,
        mutate,
      ).map((item) => item.label),
    ).toEqual(["Resume", "Extend", "Bedtime"]);
  });

  it("does not offer Pause on a Things group with no schedule", () => {
    expect(
      groupActions(
        group({
          kind: "things",
          familyRole: null,
          schedule: { enabled: false, days: [], start: null, end: null },
        }),
        "web",
        openPause,
        openExtend,
        mutate,
      ).map((item) => item.label),
    ).toEqual(["Schedule", "Detail"]);
  });
});
