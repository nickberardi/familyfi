/** Client-safe rule helpers + curated slots (mirrors server curated-categories). */

export type Rule = {
  id: string;
  kind: "category" | "app";
  scope: "group" | "network";
  groupId: string | null;
  networkIds: string[];
  targetIds: number[];
  enabled: boolean;
  mode: "always" | "scheduled";
  schedule: { enabled: boolean; days: number[]; start: string | null; end: string | null };
  internet: false;
};

export type CuratedSlot = "video" | "social" | "gaming";

export type CuratedCategorySlot = {
  slot: CuratedSlot;
  label: string;
  categoryId: number;
  catalogName: string;
};

/** Confirmed curated slots — Video / Social / Gaming only (Porn OUT). */
export const CURATED_CATEGORY_SLOTS: readonly CuratedCategorySlot[] = [
  { slot: "video", label: "Video", categoryId: 4, catalogName: "Media streaming services" },
  { slot: "social", label: "Social", categoryId: 24, catalogName: "Social networks" },
  { slot: "gaming", label: "Gaming", categoryId: 8, catalogName: "Online games" },
] as const;

export function groupScopedRules(rules: Rule[], groupId: string): Rule[] {
  return rules.filter((rule) => rule.scope === "group" && rule.groupId === groupId);
}

/** Find the category rule for a curated slot (prefer enabled). */
export function categoryRuleForSlot(rules: Rule[], groupId: string, categoryId: number): Rule | undefined {
  const matches = groupScopedRules(rules, groupId).filter(
    (rule) => rule.kind === "category" && rule.targetIds.includes(categoryId),
  );
  return matches.find((rule) => rule.enabled) ?? matches[0];
}

export function appRulesForGroup(rules: Rule[], groupId: string): Rule[] {
  return groupScopedRules(rules, groupId).filter((rule) => rule.kind === "app");
}

/** Parent-facing label: curated slot name, else catalog name, else generic — never raw DPI ids. */
export function parentFacingRuleLabel(
  rule: Rule,
  catalogNames: Map<string, string>,
): string {
  if (rule.kind === "category") {
    const slot = CURATED_CATEGORY_SLOTS.find((s) => rule.targetIds.includes(s.categoryId));
    if (slot) return slot.label;
  }
  const key = `${rule.kind}:${rule.targetIds.join(",")}`;
  const named = catalogNames.get(key);
  if (named) return named;
  if (rule.targetIds.length === 1) {
    const single = catalogNames.get(`${rule.kind}:${rule.targetIds[0]}`);
    if (single) return single;
  }
  return rule.kind === "category" ? "Category" : "App";
}

export function glyphForAppName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, "");
  return (cleaned.slice(0, 2) || "AP").toUpperCase();
}
