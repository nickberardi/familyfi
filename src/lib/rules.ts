/** Client-safe rule helpers + curated slots (mirrors server curated-categories). */

import { windowDayBands, type InternetWindow } from "./rule-windows";

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

/** The windows of the group's enabled internet rules, with the rule each came from. */
export function internetWindowsForGroup(rules: Rule[], groupId: string): InternetWindow[] {
  return internetRulesForGroup(rules, groupId)
    .filter((rule) => rule.enabled && rule.mode === "scheduled")
    .flatMap((rule) => rule.windows.map((window) => ({ ...window, ruleName: rule.name })));
}

/** The group's category, app and website rules: each blocks only its own traffic. */
export function filterRulesForGroup(rules: Rule[], groupId: string): Rule[] {
  return groupScopedRules(rules, groupId).filter((rule) => rule.kind !== "internet");
}

/** What a rule blocks, in the words its card uses. */
export function ruleBlocksLabel(rule: Pick<Rule, "kind" | "targetIds" | "domains">, catalogNames: Map<string, string>): string {
  if (rule.kind === "internet") return "All internet · every device";
  if (rule.kind === "domain") {
    const shown = rule.domains.slice(0, 2).join(", ") + (rule.domains.length > 2 ? "…" : "");
    return `${rule.domains.length} ${rule.domains.length === 1 ? "website" : "websites"} · ${shown}`;
  }
  const names = rule.targetIds.map((id) => {
    const slot = rule.kind === "category" ? CURATED_CATEGORY_SLOTS.find((item) => item.categoryId === id) : undefined;
    return slot?.label ?? catalogNames.get(`${rule.kind}:${id}`) ?? (rule.kind === "category" ? "Category" : "App");
  });
  return `${names.join(", ")} only · everything else stays on`;
}

/** A rule's bands on a day that is `weekday`, in minutes after midnight. */
export function ruleDayBands(rule: Pick<Rule, "mode" | "windows">, weekday: number): { from: number; to: number; window: RuleWindow }[] {
  if (rule.mode === "always") return [{ from: 0, to: 1440, window: { name: "Always", days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "00:00" } }];
  return rule.windows.flatMap((window) => windowDayBands(window, weekday).map((band) => ({ from: band.from, to: band.to, window })));
}

/** A window's shape on a 24-hour bar, whatever the day: one band, or two across midnight. */
export function windowSegments(window: Pick<RuleWindow, "start" | "end">): { from: number; to: number }[] {
  const [sh, sm] = window.start.split(":").map(Number);
  const [eh, em] = window.end.split(":").map(Number);
  const from = (sh ?? 0) * 60 + (sm ?? 0);
  const to = (eh ?? 0) * 60 + (em ?? 0);
  if (from === to) return [];
  return from < to ? [{ from, to }] : [{ from, to: 1440 }, { from: 0, to }];
}
