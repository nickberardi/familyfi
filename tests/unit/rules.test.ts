import { describe, expect, it } from "vitest";
import {
  CURATED_CATEGORY_SLOTS,
  appRulesForGroup,
  categoryRuleForSlot,
  glyphForAppName,
  parentFacingRuleLabel,
  type Rule,
} from "@/lib/rules";

function rule(partial: Partial<Rule> & Pick<Rule, "id" | "kind" | "targetIds">): Rule {
  return {
    scope: "group",
    groupId: "g1",
    networkIds: [],
    enabled: true,
    mode: "always",
    schedule: { enabled: false, days: [], start: null, end: null },
    internet: false,
    ...partial,
  };
}

describe("rules helpers", () => {
  it("exposes three curated slots without Porn", () => {
    expect(CURATED_CATEGORY_SLOTS.map((s) => s.slot)).toEqual(["video", "social", "gaming"]);
    expect(CURATED_CATEGORY_SLOTS.map((s) => s.categoryId)).toEqual([4, 24, 8]);
  });

  it("resolves category and app rules for a group", () => {
    const rules = [
      rule({ id: "c-off", kind: "category", targetIds: [4], enabled: false }),
      rule({ id: "c", kind: "category", targetIds: [4], enabled: true }),
      rule({ id: "a", kind: "app", targetIds: [100], enabled: false }),
      rule({ id: "other", kind: "category", groupId: "g2", targetIds: [24] }),
    ];
    expect(categoryRuleForSlot(rules, "g1", 4)?.id).toBe("c");
    expect(categoryRuleForSlot(rules, "g1", 24)).toBeUndefined();
    expect(appRulesForGroup(rules, "g1").map((r) => r.id)).toEqual(["a"]);
  });

  it("parent-facing labels never fall back to raw DPI ids", () => {
    const catalog = new Map([["app:99", "TikTok"]]);
    expect(parentFacingRuleLabel(rule({ id: "1", kind: "category", targetIds: [4] }), catalog)).toBe("Video");
    expect(parentFacingRuleLabel(rule({ id: "2", kind: "app", targetIds: [99] }), catalog)).toBe("TikTok");
    expect(parentFacingRuleLabel(rule({ id: "3", kind: "app", targetIds: [12345] }), catalog)).toBe("App");
    expect(glyphForAppName("TikTok")).toBe("TI");
  });
});
