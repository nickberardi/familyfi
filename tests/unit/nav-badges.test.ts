import { describe, expect, it } from "vitest";

import { navBadge, navBadgeTone, navGroupBadge, type NavCounts } from "@/lib/nav";

const none: NavCounts = { unassignedCount: 0, familyNeedsDevices: 0, syncFailed: false, checkupProblems: 0 };

describe("navigation badges", () => {
  it("counts each destination's own notice and nothing for the rest", () => {
    const counts: NavCounts = { unassignedCount: 3, familyNeedsDevices: 2, syncFailed: true, checkupProblems: 4 };
    expect(navBadge("/devices", counts)).toBe(3);
    expect(navBadge("/family", counts)).toBe(2);
    expect(navBadge("/checkup", counts)).toBe(4);
    expect(navBadge("/sync", counts)).toBe(1);
    expect(navBadge("/rules", counts)).toBe(0);
    expect(navBadge("/sync", none)).toBe(0);
  });

  it("never draws a family member without a device or Checkup's problems as urgent", () => {
    expect(navBadgeTone("/family")).toBe("paused");
    expect(navBadgeTone("/checkup")).toBe("paused");
    expect(navBadgeTone("/devices")).toBe("danger");
    expect(navBadgeTone("/sync")).toBe("danger");
  });

  it("totals a group, urgent only when an urgent badge counts", () => {
    expect(navGroupBadge("Network", { ...none, checkupProblems: 2 })).toEqual({ total: 2, tone: "paused" });
    expect(navGroupBadge("Network", { ...none, checkupProblems: 2, unassignedCount: 1 })).toEqual({ total: 3, tone: "danger" });
    expect(navGroupBadge("Household", { ...none, familyNeedsDevices: 1 })).toEqual({ total: 1, tone: "paused" });
    expect(navGroupBadge("System", { ...none, syncFailed: true })).toEqual({ total: 1, tone: "danger" });
    expect(navGroupBadge("System", none)).toEqual({ total: 0, tone: "paused" });
  });

  it("leaves out a destination badged somewhere else", () => {
    // The app's Devices tab carries its own count, so the Network section's does not repeat it.
    expect(navGroupBadge("Network", { ...none, checkupProblems: 2, unassignedCount: 5 }, ["/devices"])).toEqual({ total: 2, tone: "paused" });
  });
});
