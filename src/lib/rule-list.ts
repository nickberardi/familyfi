/**
 * The Rules list every client shows: which rules a scope shows, how each card reads, and its copy.
 * Internet rules lead with a square globe and the accent; category, app and website rules take the
 * round mark and the rule verdict's lighter treatment, so the two never read alike.
 */
import { daysLabel, windowTimes } from "./display";
import type { IconName } from "./icons";
import { ruleStateLine } from "./rule-actions";
import { ruleActivelyBlocking } from "./upstream";
import {
  CURATED_CATEGORY_SLOTS,
  ruleLiftedForGroup,
  rulePaused,
  windowSegments,
  type CuratedSlot,
  type Rule,
  type RuleWindow,
} from "./rules";
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

/** A rule's own page. Quarantine cannot be edited, so it opens the devices it holds instead. */
export function ruleHref(rule: Pick<Rule, "id"> & Partial<Pick<Rule, "builtIn">>): string {
  return rule.builtIn === "quarantine" ? "/devices" : `/rules/${rule.id}`;
}

/** The words on the way to a rule's own page: Edit, or for quarantine, which cannot be edited, its devices. */
export function ruleOpenLabel(rule: Partial<Pick<Rule, "builtIn">>): string {
  return rule.builtIn === "quarantine" ? "Devices" : "Edit";
}

/** Who a rule covers, by name: its groups, or its whole networks. */
export function ruleAppliesTo(
  rule: Pick<Rule, "scope" | "groupIds" | "networkIds"> & Partial<Pick<Rule, "builtIn">>,
  groups: Pick<Group, "id" | "name">[],
  networks: Network[],
): string[] {
  if (rule.builtIn === "quarantine") return [RULES_COPY.unassigned];
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

/**
 * A rule in one line under its name, as a stacked card shows it closed, in the colour that says
 * whether it is doing anything: off, paused or allowed, blocking now, or on with its schedule.
 * `tone` is a `--ff-*` token name.
 */
export function ruleStatus(
  rule: Pick<Rule, "enabled" | "mode" | "windows" | "pause" | "scope" | "groupIds" | "groupPauses">,
  timezone: string,
  now: Date,
): { line: string; tone: "muted" | "paused" | "danger" | "on" } {
  if (!rule.enabled) return { line: "Off · Not enforced", tone: "muted" };
  const paused = ruleStateLine(rule, timezone, now);
  if (paused) return { line: paused, tone: "paused" };
  // Lifted for each group it covers, one by one, the rule blocks no one even inside a window.
  const lifts =
    rule.scope === "group" && rule.groupIds.length > 0
      ? rule.groupIds.map((id) =>
          rule.groupPauses.find((item) => item.groupId === id && ruleLiftedForGroup(rule, id, now)),
        )
      : [];
  if (lifts.length && lifts.every(Boolean)) {
    const kinds = new Set(lifts.map((item) => item!.pause.kind));
    const verb = kinds.size > 1 ? "Paused or allowed" : kinds.has("allow") ? "Allowed" : "Paused";
    return { line: `${verb} for every group`, tone: "paused" };
  }
  if (ruleActivelyBlocking(rule, timezone, now)) {
    return { line: "On · Blocking now", tone: "danger" };
  }
  const [first] = ruleWhenLines(rule);
  return { line: `On · ${first ? `${first.times}${first.days ? ` · ${first.days}` : ""}` : "No windows"}`, tone: "on" };
}

/** The rule's kind at a glance: a square globe for all internet, a round mark for anything narrower. */
export function ruleMarkSpec(rule: Pick<Rule, "kind" | "targetIds">): {
  shape: "square" | "round";
  slot?: CuratedSlot;
  icon: IconName;
} {
  if (rule.kind === "internet") return { shape: "square", icon: "globe-simple" };
  const slot =
    rule.kind === "category"
      ? CURATED_CATEGORY_SLOTS.find((item) => rule.targetIds.includes(item.categoryId))
      : undefined;
  return {
    shape: "round",
    ...(slot ? { slot: slot.slot } : {}),
    icon: rule.kind === "app" ? "app-window" : rule.kind === "domain" ? "link-simple" : "prohibit",
  };
}

/** The minutes a rule blocks on a 24-hour bar, any day. */
export function ruleBarBands(rule: {
  mode: Rule["mode"];
  windows: Pick<RuleWindow, "start" | "end">[];
}): { from: number; to: number }[] {
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
  blocks: "Blocks",
  when: "When",
  appliesTo: "Applies to",
  unassigned: "Unassigned devices",
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
