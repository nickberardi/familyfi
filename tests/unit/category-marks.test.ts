import { describe, expect, it } from "vitest";
import { cardMarks, categoryRuleWhen, categorySheet, categorySlotStates, loadFilterCatalog, moreMarkLabels, type CategorySlotState } from "@/lib/category-marks";
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
