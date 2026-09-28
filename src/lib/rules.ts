/** Client-safe rule helpers + curated slots (mirrors server curated-categories). */

export type RuleKind = "internet" | "category" | "app" | "domain";

export type RuleWindow = { id?: string; name: string; days: number[]; start: string; end: string };

export type Rule = {
  id: string;
  name: string;
  kind: RuleKind;
  scope: "group" | "network";
  groupIds: string[];
  networkIds: string[];
  targetIds: number[];
  domains: string[];
  enabled: boolean;
  mode: "always" | "scheduled";
  windows: (RuleWindow & { id: string })[];
  useGeneratedName: boolean;
  policyNames: string[];
};

export const MAX_RULE_NAME = 60;
export const MAX_WINDOW_NAME = 30;
export const MAX_RULE_WINDOWS = 12;
export const MAX_RULE_DOMAINS = 100;

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/**
 * "https://www.TikTok.com/foryou" → "www.tiktok.com". The gateway blocks a domain and its
 * subdomains. Null when what is left is not a hostname with a dot.
 */
export function normalizeDomain(raw: string): string | null {
  let value = raw.trim().toLowerCase();
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
  if (value.startsWith("*.")) value = value.slice(2);
  return HOSTNAME.test(value) ? value : null;
}

export type CuratedSlot = "video" | "social" | "gaming" | "vpn" | "messaging";

export type CuratedCategorySlot = {
  slot: CuratedSlot;
  label: string;
  categoryId: number;
  catalogName: string;
};

/**
 * Confirmed curated slots (Porn OUT). Mirrors
 * `src/server/unifi/curated-categories.ts` — including Messaging's id of 0, which
 * is a real DPI category, so never test a target id for truthiness.
 */
export const CURATED_CATEGORY_SLOTS: readonly CuratedCategorySlot[] = [
  { slot: "video", label: "Video", categoryId: 4, catalogName: "Media streaming services" },
  { slot: "social", label: "Social", categoryId: 24, catalogName: "Social networks" },
  { slot: "gaming", label: "Gaming", categoryId: 8, catalogName: "Online games" },
  { slot: "vpn", label: "VPN", categoryId: 11, catalogName: "Tunneling and proxy services" },
  { slot: "messaging", label: "Messaging", categoryId: 0, catalogName: "Instant messengers" },
] as const;

export function groupScopedRules(rules: Rule[], groupId: string): Rule[] {
  return rules.filter((rule) => rule.scope === "group" && rule.groupIds.includes(groupId));
}

/** The group's internet rules, oldest first. */
export function internetRulesForGroup(rules: Rule[], groupId: string): Rule[] {
  return groupScopedRules(rules, groupId).filter((rule) => rule.kind === "internet");
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
  return rule.kind === "category" ? "Category" : rule.kind === "app" ? "App" : rule.name;
}

export function glyphForAppName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, "");
  return (cleaned.slice(0, 2) || "AP").toUpperCase();
}
