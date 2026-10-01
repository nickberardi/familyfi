/**
 * The Rules list every client shows: which rules a scope shows, how each card reads, and its copy.
 * Internet rules lead with a square globe and the accent; category, app and website rules take the
 * round mark and the rule verdict's lighter treatment, so the two never read alike.
 */
import { daysLabel, windowTimes } from "./display";
import type { IconName } from "./icons";
import { CURATED_CATEGORY_SLOTS, rulePaused, windowSegments, type CuratedSlot, type Rule, type RuleWindow } from "./rules";
import type { Group } from "./types";

type Network = { id: string; name: string };

export type RulesListView = {
  /** The group the list is narrowed to, or undefined for every rule. */
  scoped: Group | undefined;
  list: Rule[];
  /** The groups some rule covers, to narrow the list by. */
  chips: Group[];
  /** The groups no rule covers. */
  unruled: string[];
  newHref: string;
};

export function rulesListView(rules: Rule[], groups: Group[], scope: string | null | undefined): RulesListView {
  const scoped = scope ? groups.find((group) => group.id === scope) : undefined;
  const covered = new Set(rules.flatMap((rule) => rule.groupIds));
  return {
    scoped,
    list: scoped ? rules.filter((rule) => rule.groupIds.includes(scoped.id)) : rules,
    chips: groups.filter((group) => covered.has(group.id)),
    unruled: groups.filter((group) => !covered.has(group.id)).map((group) => group.name),
    newHref: scoped ? `/rules/new?group=${scoped.id}` : "/rules/new",
  };
}

/** Where a scope chip goes: the list for that group, or every rule. */
export function rulesScopeHref(groupId: string | null): string {
  return groupId ? `/rules?group=${groupId}` : "/rules";
}

/** A rule's own page. */
export function ruleHref(rule: Pick<Rule, "id">): string {
  return `/rules/${rule.id}`;
}

/** Who a rule covers, by name: its groups, or its whole networks. */
export function ruleAppliesTo(rule: Pick<Rule, "scope" | "groupIds" | "networkIds">, groups: Pick<Group, "id" | "name">[], networks: Network[]): string[] {
  return rule.scope === "network"
    ? rule.networkIds.map((id) => networks.find((network) => network.id === id)?.name ?? "Network")
    : rule.groupIds.map((id) => groups.find((group) => group.id === id)?.name ?? "Deleted group");
}

/** When a rule blocks, a line per window: "Always", or each window's times and days, named when there are several. */
export function ruleWhenLines(rule: Pick<Rule, "mode" | "windows">): { key: string; times: string; days?: string }[] {
  if (rule.mode === "always") return [{ key: "always", times: "Always" }];
  return rule.windows.map((window) => ({
    key: window.id,
    times: `${rule.windows.length > 1 && window.name ? `${window.name} · ` : ""}${windowTimes(window.start, window.end)}`,
    days: daysLabel(window.days),
  }));
}

/** A rule that is off or paused reads quieter. */
export function ruleCardDimmed(rule: Pick<Rule, "enabled" | "pause">, now: Date): boolean {
  return !rule.enabled || rulePaused(rule, now);
}

/** The rule's kind at a glance: a square globe for all internet, a round mark for anything narrower. */
export function ruleMarkSpec(rule: Pick<Rule, "kind" | "targetIds">): { shape: "square" | "round"; slot?: CuratedSlot; icon: IconName } {
  if (rule.kind === "internet") return { shape: "square", icon: "globe-simple" };
  const slot = rule.kind === "category" ? CURATED_CATEGORY_SLOTS.find((item) => rule.targetIds.includes(item.categoryId)) : undefined;
  return {
    shape: "round",
    ...(slot ? { slot: slot.slot } : {}),
    icon: rule.kind === "app" ? "app-window" : rule.kind === "domain" ? "link-simple" : "prohibit",
  };
}

/** The minutes a rule blocks on a 24-hour bar, any day. */
export function ruleBarBands(rule: { mode: Rule["mode"]; windows: Pick<RuleWindow, "start" | "end">[] }): { from: number; to: number }[] {
  return rule.mode === "always" ? [{ from: 0, to: 1440 }] : rule.windows.flatMap(windowSegments);
}

/** The 24-hour bar's labels, evenly spaced. */
export const RULE_BAR_TICKS = ["12 AM", "6 AM", "NOON", "6 PM", "12 AM"] as const;

/** What turning a rule on or off says. */
export function ruleToggleNotice(rule: Pick<Rule, "name" | "enabled">): string {
  return `${rule.name} turned ${rule.enabled ? "off" : "on"}. FamilyFi writes it to the gateway next.`;
}

export const RULES_COPY = {
  title: "Rules",
  subtitle: "What is blocked, when, and for whom",
  newRule: "New rule",
  scopeLabel: "Show rules for",
  all: "All",
  when: "When",
  appliesTo: "Applies to",
  footnote:
    "Each window is its own UniFi policy. Edits are desired configuration, written to UniFi on the next reconcile; Sync shows whether the gateway accepted them.",
} as const;

/** A group with no rules: it stays online and unfiltered. */
export function noRulesFor(group: Pick<Group, "name" | "kind">): string {
  return `No rules for ${group.name} yet. ${group.kind === "things" ? "Its devices" : "Their devices"} stay online and unfiltered.`;
}

/** The groups no rule covers, in a sentence. */
export function unruledLine(names: string[]): string {
  return `No rules: ${names.join(", ")}. They stay online and unfiltered.`;
}
