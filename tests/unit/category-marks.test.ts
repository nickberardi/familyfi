import { describe, expect, it } from "vitest";
import { cardMarks, categoryRuleWhen, fitCardMarks, marksRoom, categorySheet, categorySlotStates, loadFilterCatalog, moreMarkLabels, type CategorySlotState } from "@/lib/category-marks";
import type { Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";

const slot = (key: string, enabled?: boolean) => ({ key, label: key, rule: enabled === undefined ? undefined : ({ enabled } as Rule) }) as CategorySlotState;
const group = { id: "g1", name: "A child", kind: "family", dohOverrideUrl: null } as unknown as Group;

describe("category marks", () => {
  it("lists every curated category for a group, with no rule and nothing measured as unknown", () => {
    const slots = categorySlotStates(group, [], [], "America/New_York");
    expect(slots.map((item) => item.key)).toEqual(["video", "social", "gaming", "vpn", "messaging"]);
    expect(slots.every((item) => item.state === "unknown" && !item.blocking)).toBe(true);
    expect(categorySheet(slots[0]!)).toMatchObject({ kind: "category", name: "Video", rule: undefined, upstream: null, activelyBlocking: false });
  });

  it("marks every category a rule over several blocks, though another rule for one of them is off now", () => {
    const base = {
      kind: "category",
      scope: "group",
      groupIds: ["g1"],
      networkIds: [],
      domains: [],
      enabled: true,
      pause: { active: false, until: null, kind: "pause", by: null },
      groupPauses: [],
      mode: "scheduled",
      useGeneratedName: false,
      policyNames: [],
      builtIn: null,
    } as const;
    const every = [0, 1, 2, 3, 4, 5, 6];
    // Thursday 4:30 PM in New York: Homework (Video and Social) blocks, the evening Video rule does not.
    const now = new Date("2026-10-15T20:30:00Z");
    const video = { ...base, id: "r-video", name: "Video", targetIds: [4], windows: [{ id: "v", name: "", days: every, start: "20:00", end: "22:00" }] } as unknown as Rule;
    const homework = { ...base, id: "r-homework", name: "Homework", targetIds: [4, 24], windows: [{ id: "h", name: "", days: every, start: "16:00", end: "18:00" }] } as unknown as Rule;
    const slots = categorySlotStates(group, [video, homework], [], "America/New_York", now);
    expect(slots.filter((item) => item.blocking).map((item) => [item.key, item.rule?.id])).toEqual([
      ["video", "r-homework"],
      ["social", "r-homework"],
    ]);
  });

  it("puts FamilyFi's own rules first and shows a few before More", () => {
    const slots = [slot("a"), slot("b"), slot("c", true), slot("d"), slot("e"), slot("f")];
    const closed = cardMarks(slots, { open: false, more: false });
    expect(closed.ordered.map((item) => item.key)).toEqual(["c", "a", "b", "d", "e", "f"]);
    expect(closed.shown.map((item) => item.key)).toEqual(["c", "a", "b", "d"]);
    expect(closed.hidden).toBe(2);
  });

  it("lists every category on an open card, a few more before More", () => {
    const slots = [slot("a"), slot("b"), slot("c", true), slot("d"), slot("e"), slot("f")];
    const open = cardMarks(slots, { open: true, more: false });
    expect(open.shown.map((item) => item.key)).toEqual(["c", "a", "b", "d", "e"]);
    expect(open.hidden).toBe(1);
  });

  it("keeps More on the row's last place when the marks do not all fit", () => {
    const slots = [slot("a"), slot("b"), slot("c"), slot("d"), slot("e"), slot("f")];
    const closed = cardMarks(slots, { open: false, more: false });
    // Room for four: three categories and More, not four with More wrapping alone.
    expect(fitCardMarks(closed, 4).shown.map((item) => item.key)).toEqual(["a", "b", "c"]);
    expect(fitCardMarks(closed, 4).hidden).toBe(3);
    // Room to spare changes nothing.
    expect(fitCardMarks(closed, 9)).toEqual(closed);
    // Four categories alone fit in four places; in three, two show and More holds the last.
    const four = cardMarks(slots.slice(0, 4), { open: false, more: false });
    expect(fitCardMarks(four, 4)).toEqual(four);
    expect(fitCardMarks(four, 3).shown.map((item) => item.key)).toEqual(["a", "b"]);
    expect(fitCardMarks(four, 3).hidden).toBe(2);
    // Expanded, every mark shows and the row wraps, and Fewer stays even when only the narrow row hid any.
    expect(fitCardMarks(cardMarks(slots, { open: false, more: true }), 2).shown).toHaveLength(6);
    expect(fitCardMarks(cardMarks(slots.slice(0, 4), { open: false, more: true }), 3).hidden).toBe(2);
  });

  it("counts the marks a row fits, after the Internet mark when closed", () => {
    // A 402px phone's card: Internet, three categories and More closed; five open.
    expect(marksRoom(370, false)).toBe(4);
    expect(marksRoom(370, true)).toBe(5);
    // A 320px phone's card.
    expect(marksRoom(288, false)).toBe(2);
  });

  it("says what More does, and when a rule blocks", () => {
    expect(moreMarkLabels(false, 9, 5)).toEqual({ accessibilityLabel: "Show all 9 categories", badge: "+5", word: "More" });
    expect(moreMarkLabels(true, 9, 5)).toMatchObject({ badge: "–", word: "Fewer" });
    expect(categoryRuleWhen({ mode: "always", windows: [] })).toBe("Always blocked by FamilyFi.");
  });

  it("loads the catalog's names and the resolver's categories, and reads a list that fails as empty", async () => {
    const lists: Record<string, unknown> = {
      "/api/v1/dpi/categories": { categories: [{ id: 4, name: "Video Streaming" }] },
      "/api/v1/dpi/applications": { applications: [{ id: 9, name: "Fixture App" }] },
    };
    const request = (async (path: string) => (path in lists ? lists[path] : Promise.reject(new Error("down")))) as never;
    const { catalogNames, upstreamCategories } = await loadFilterCatalog(request);
    expect(catalogNames.get("category:4")).toBe("Video Streaming");
    expect(catalogNames.get("app:9")).toBe("Fixture App");
    expect(upstreamCategories).toEqual([]);
  });
});
