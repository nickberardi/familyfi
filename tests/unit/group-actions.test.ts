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
    dohOverrideUrl: null,
    access: "available",
    ...overrides,
  };
}

const mutate = vi.fn();
const openPause = vi.fn();
const openExtend = vi.fn();

describe("groupActions", () => {
  it("uses Pause, Rules, and Detail on the web parent card", () => {
    const actions = groupActions(group(), "web", openPause, openExtend, mutate);
    expect(actions.map((item) => item.label)).toEqual(["Pause", "Rules", "Detail"]);
    expect(actions.find((item) => item.label === "Rules")?.href).toBe("/rules#group-g1");
  });

  it("omits Detail on the phone card because the row already navigates", () => {
    expect(groupActions(group(), "phone", openPause, openExtend, mutate).map((item) => item.label)).toEqual([
      "Pause",
      "Rules",
    ]);
  });

  it("caps a paused card at Resume, Extend, and Rules", () => {
    expect(
      groupActions(
        group({ suspension: { active: true, until: "2026-09-14T20:00:00.000Z" }, access: "paused" }),
        "web",
        openPause,
        openExtend,
        mutate,
      ).map((item) => item.label),
    ).toEqual(["Resume", "Extend", "Rules"]);
  });

  it("does not offer Pause on a Things group with no schedule", () => {
    const actions = groupActions(
      group({
        kind: "things",
        familyRole: null,
        schedule: { enabled: false, days: [], start: null, end: null },
      }),
      "web",
      openPause,
      openExtend,
      mutate,
    );
    expect(actions.map((item) => item.label)).toEqual(["Rules", "Detail"]);
    expect(actions[0]?.href).toBe("/rules#group-g1");
  });

  /* `groupActionSpecs` is pinned by tests/fixtures/display-vectors.json; this checks the wiring. */
  it("binds each tap to its handler", () => {
    const pauseCard = groupActions(group(), "web", openPause, openExtend, mutate);
    pauseCard[0]?.onClick?.();
    expect(openPause).toHaveBeenCalledWith(expect.objectContaining({ id: "g1" }));
    expect(pauseCard.slice(1).every((item) => item.onClick === undefined)).toBe(true);

    const pausedCard = groupActions(
      group({ suspension: { active: true, until: null }, access: "paused" }),
      "phone",
      openPause,
      openExtend,
      mutate,
    );
    pausedCard[0]?.onClick?.();
    expect(mutate).toHaveBeenCalledTimes(1);
    pausedCard[1]?.onClick?.();
    expect(openExtend).toHaveBeenCalledWith(expect.objectContaining({ id: "g1" }));
  });
});
