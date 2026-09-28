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
    deviceCount: 4,
    suspension: { active: false, until: null, by: null },
    allowance: { active: false, until: null, by: null },
    internetRuleIds: ["r1"],
    dohOverrideUrl: null,
    access: "available",
    ...overrides,
  };
}

const mutate = vi.fn();
const openPause = vi.fn();
const openExtend = vi.fn();
const labels = (value: Group, surface: "phone" | "web" = "web") =>
  groupActions(value, surface, openPause, openExtend, mutate).map((item) => item.label);

describe("groupActions", () => {
  it("names the scope: Pause all internet, then Rules and Detail on the web card", () => {
    const actions = groupActions(group(), "web", openPause, openExtend, mutate);
    expect(actions.map((item) => item.label)).toEqual(["Pause all internet", "Rules", "Detail"]);
    expect(actions.find((item) => item.label === "Rules")?.href).toBe("/rules?group=g1");
  });

  it("omits Detail on the phone card because the row already navigates", () => {
    expect(labels(group(), "phone")).toEqual(["Pause all internet", "Rules"]);
  });

  it("offers Pause on a group with no internet rule", () => {
    expect(labels(group({ kind: "things", familyRole: null, internetRuleIds: [] }))).toEqual(["Pause all internet", "Rules", "Detail"]);
  });

  it("resumes a pause, allows during a window, and resumes a schedule after an allowance", () => {
    expect(labels(group({ suspension: { active: true, until: "2026-09-14T20:00:00.000Z", by: null }, access: "paused" }))).toEqual([
      "Resume internet",
      "More time",
      "Rules",
    ]);
    expect(labels(group({ access: "blocked" }))).toEqual(["Allow internet now", "Rules"]);
    expect(labels(group({ access: "allowed", allowance: { active: true, until: null, by: null } }))).toEqual([
      "Resume schedule",
      "Pause all internet",
      "Rules",
    ]);
  });

  /* `groupActionSpecs` is pinned by tests/fixtures/display-vectors.json; this checks the wiring. */
  it("binds each tap to its handler", () => {
    const pauseCard = groupActions(group(), "web", openPause, openExtend, mutate);
    pauseCard[0]?.onClick?.();
    expect(openPause).toHaveBeenCalledWith(expect.objectContaining({ id: "g1" }));
    expect(pauseCard.slice(1).every((item) => item.onClick === undefined)).toBe(true);

    const pausedCard = groupActions(group({ suspension: { active: true, until: null, by: null }, access: "paused" }), "phone", openPause, openExtend, mutate);
    pausedCard[0]?.onClick?.();
    expect(mutate).toHaveBeenCalledTimes(1);
    pausedCard[1]?.onClick?.();
    expect(openExtend).toHaveBeenCalledWith(expect.objectContaining({ id: "g1" }));

    groupActions(group({ access: "blocked" }), "web", openPause, openExtend, mutate)[0]?.onClick?.();
    groupActions(group({ access: "allowed" }), "web", openPause, openExtend, mutate)[0]?.onClick?.();
    expect(mutate).toHaveBeenCalledTimes(3);
  });
});
