/** Client-safe Fam rule helpers + D6 curated slots (mirrors server d6-categories). */

export type FamRule = {
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

export type D6Slot = "video" | "social" | "gaming";

export type D6CategorySlot = {
  slot: D6Slot;
  label: string;
  categoryId: number;
  catalogName: string;
};

/** Confirmed D6 curated slots — Video / Social / Gaming only (Porn OUT). */
export const D6_CATEGORY_SLOTS: readonly D6CategorySlot[] = [
  { slot: "video", label: "Video", categoryId: 4, catalogName: "Media streaming services" },
  { slot: "social", label: "Social", categoryId: 24, catalogName: "Social networks" },
  { slot: "gaming", label: "Gaming", categoryId: 8, catalogName: "Online games" },
] as const;

export function groupScopedRules(rules: FamRule[], groupId: string): FamRule[] {
  return rules.filter((rule) => rule.scope === "group" && rule.groupId === groupId);
}

/** Find the Fam category rule for a curated D6 slot (prefer enabled). */
export function categoryRuleForSlot(rules: FamRule[], groupId: string, categoryId: number): FamRule | undefined {
  const matches = groupScopedRules(rules, groupId).filter(
    (rule) => rule.kind === "category" && rule.targetIds.includes(categoryId),
  );
  return matches.find((rule) => rule.enabled) ?? matches[0];
}

export function appRulesForGroup(rules: FamRule[], groupId: string): FamRule[] {
  return groupScopedRules(rules, groupId).filter((rule) => rule.kind === "app");
}

/** Parent-facing label: curated slot name, else catalog name, else generic — never raw DPI ids. */
export function parentFacingRuleLabel(
  rule: FamRule,
  catalogNames: Map<string, string>,
): string {
  if (rule.kind === "category") {
    const slot = D6_CATEGORY_SLOTS.find((s) => rule.targetIds.includes(s.categoryId));
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
