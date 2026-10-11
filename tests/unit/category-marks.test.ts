import { describe, expect, it } from "vitest";
import { cardMarks, categoryRuleItems, categoryRuleWhen, stackedCardMarks, fitCardMarks, marksRoom, categorySheet, categorySlotStates, loadFilterCatalog, moreMarkLabels, type CategorySlotState } from "@/lib/category-marks";
import { CURATED_CATEGORY_SLOTS, type Rule } from "@/lib/rules";
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

  it("puts FamilyFi's own rules first and shows a few before More", () => {
    const slots = [slot("a"), slot("b"), slot("c", true), slot("d"), slot("e"), slot("f")];
    const closed = cardMarks(slots, { open: false, focus: null, more: false });
    expect(closed.ordered.map((item) => item.key)).toEqual(["c", "a", "b", "d", "e", "f"]);
    expect(closed.shown.map((item) => item.key)).toEqual(["c", "a", "b", "d"]);
    expect(closed.hidden).toBe(2);
    expect(closed.focused).toBeUndefined();
  });

  it("focuses the tapped category on an open card, and lists the rest", () => {
    const slots = [slot("a"), slot("b"), slot("c")];
    const open = cardMarks(slots, { open: true, focus: "b", more: false });
    expect(open.focused?.key).toBe("b");
    expect(open.shown.map((item) => item.key)).toEqual(["a", "c"]);
    expect(open.hidden).toBe(0);
  });

  it("lists a stacked card's categories by what blocks them: rules, the resolver, then the rest", () => {
    const upstream = (key: string, state: CategorySlotState["state"]) => ({ ...slot(key), state }) as CategorySlotState;
    const slots = [upstream("a", "open"), slot("b", true), upstream("c", "blocked"), slot("d", false), upstream("e", "partial"), upstream("f", "unknown")];
    const stacked = stackedCardMarks(slots, false, [slots[1]!]);
    expect(stacked.ruled.map((item) => item.key)).toEqual(["b"]);
    expect(stacked.upstream.map((item) => item.key)).toEqual(["c", "e"]);
    // A rule that is off is no rule: its category is one of the others.
    expect(stacked.marks.pool.map((item) => item.key)).toEqual(["a", "d", "f"]);
    expect(stacked.marks.focused).toBeUndefined();
    expect(stacked.marks.hidden).toBe(0);
    const many = stackedCardMarks([...Array(7).keys()].map((index) => slot(`x${index}`)), false, []);
    expect(many.marks.shown).toHaveLength(5);
    expect(many.marks.hidden).toBe(2);
    expect(stackedCardMarks([...Array(7).keys()].map((index) => slot(`x${index}`)), true, []).marks.shown).toHaveLength(7);
  });

  it("gives a stacked card a zone for every enabled category rule, curated or not", () => {
    const video = CURATED_CATEGORY_SLOTS[0]!;
    const rule = (id: string, targetIds: number[], over: Partial<Rule> = {}) =>
      ({
        id,
        name: id,
        kind: "category",
        scope: "group",
        enabled: true,
        groupIds: ["g1"],
        networkIds: [],
        targetIds,
        domains: [],
        mode: "always",
        windows: [],
        pause: { active: false, until: null, kind: "pause", by: null },
        groupPauses: [],
        ...over,
      }) as Rule;
    const rules = [
      rule("first", [video.categoryId]),
      rule("second", [video.categoryId]),
      rule("gateway", [999]),
      rule("off", [998], { enabled: false }),
      rule("elsewhere", [997], { groupIds: ["g2"] }),
      rule("app", [5], { kind: "app" }),
    ];
    const slots = categorySlotStates(group, rules, [], "America/New_York");
    const names = new Map([["category:999", "Shopping"]]);
    const items = categoryRuleItems("g1", rules, slots, names, "America/New_York");
    expect(items.map((item) => item.key)).toEqual([video.slot, `${video.slot}:second`, "rule:gateway"]);
    expect(items.map((item) => item.rule?.id)).toEqual(["first", "second", "gateway"]);
    // A gateway category no slot names takes its catalog name, and an always rule blocks it now.
    expect(items[2]).toMatchObject({ label: "Shopping", slot: undefined, blocking: true, state: "rule" });
    // Its zone is in `ruled`, so the curated slot is not offered again as another category.
    const stacked = stackedCardMarks(slots, false, items);
    expect(stacked.marks.pool.map((item) => item.key)).not.toContain(video.slot);
  });

  it("keeps More on the row's last place when the marks do not all fit", () => {
    const slots = [slot("a"), slot("b"), slot("c"), slot("d"), slot("e"), slot("f")];
    const closed = cardMarks(slots, { open: false, focus: null, more: false });
    // Room for four: three categories and More, not four with More wrapping alone.
    expect(fitCardMarks(closed, 4).shown.map((item) => item.key)).toEqual(["a", "b", "c"]);
    expect(fitCardMarks(closed, 4).hidden).toBe(3);
    // Room to spare changes nothing.
    expect(fitCardMarks(closed, 9)).toEqual(closed);
    // Four categories alone fit in four places; in three, two show and More holds the last.
    const four = cardMarks(slots.slice(0, 4), { open: false, focus: null, more: false });
    expect(fitCardMarks(four, 4)).toEqual(four);
    expect(fitCardMarks(four, 3).shown.map((item) => item.key)).toEqual(["a", "b"]);
    expect(fitCardMarks(four, 3).hidden).toBe(2);
    // Expanded, every mark shows and the row wraps, and Fewer stays even when only the narrow row hid any.
    expect(fitCardMarks(cardMarks(slots, { open: false, focus: null, more: true }), 2).shown).toHaveLength(6);
    expect(fitCardMarks(cardMarks(slots.slice(0, 4), { open: false, focus: null, more: true }), 3).hidden).toBe(2);
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
