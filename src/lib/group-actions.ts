import { cardStateLabel, formatClock } from "./display";
import { isWindowActive, windowEndsAt, windowTitle } from "./rule-windows";
import {
  activeWindowsEnd,
  CURATED_CATEGORY_SLOTS,
  groupLift,
  groupScopedRules,
  internetWindowsForGroup,
  ruleInternetWindows,
  rulePaused,
  type Rule,
  type RuleKind,
} from "./rules";
import type { Actor, Group } from "./types";

/*
 * What a group card says and offers, as plain data: familyfi-mobile imports this module, its
 * Apple Watch ports it, and `tests/fixtures/display-vectors.json` pins it.
 *
 * A group as a whole is blocked and unblocked: Block blocks all its internet, and Unblock lifts
 * whatever is blocking it now, of any kind. A single rule under a group is paused and resumed,
 * for that group alone. Either way the rule itself never changes, and a place shows one button
 * for its state, never its opposite beside it.
 */

/** What a tap on the group's header button, or its More time link, does. */
export type GroupRun = "block" | "moreBlock" | "unblock" | "unblockNow" | "resume" | "moreUnblock";

export type GroupActionSpec = { label: string; run: GroupRun };

/** What a tap on a rule area's button, or its More time link, does for the card's group. */
export type GroupRuleRun = "pause" | "resume" | "extend";

export type GroupRuleActionSpec = { label: string; run: GroupRuleRun };

/** One of the group's rules blocking it now: what it is called, and when its active windows end (null: never). */
export type BlockingRule = { ruleId: string; kind: RuleKind; name: string; until: string | null };

/** A lift the group has on its rules: until when (null: until ended), and who made it. */
export type GroupLiftState = { until: string | null; by: Actor };

/**
 * The group's rules blocking it now, of every kind, longest first. A rule that is off, paused for
 * everyone or lifted for this group is not blocking. An internet rule is named by its window.
 * Block countries is protection, not a block on the group: it never makes a group read as blocked.
 */
export function rulesBlockingGroup(group: Pick<Group, "id">, rules: Rule[], timezone: string, now: Date): BlockingRule[] {
  const lasts = (until: string | null) => (until === null ? Number.MAX_SAFE_INTEGER : Date.parse(until));
  return groupScopedRules(rules, group.id)
    .flatMap((rule) => {
      if (rule.builtIn || !rule.enabled || rulePaused(rule, now) || groupLift(rule, group.id, now)) return [];
      const ends = activeWindowsEnd(ruleInternetWindows(rule), now, timezone);
      if (ends === undefined) return [];
      return [{ ruleId: rule.id, kind: rule.kind, name: blockingName(rule, now, timezone), until: ends?.toISOString() ?? null }];
    })
    .sort((a, b) => lasts(b.until) - lasts(a.until));
}

/** "Video" for a category FamilyFi knows, an internet rule's window ("Dinner"), else the rule's name. */
function blockingName(rule: Rule, now: Date, timezone: string): string {
  if (rule.kind === "internet") {
    const lasts = (end: Date | null) => end?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const active = ruleInternetWindows(rule)
      .filter((window) => isWindowActive(window, now, timezone))
      .sort((a, b) => lasts(windowEndsAt(b, now, timezone)) - lasts(windowEndsAt(a, now, timezone)));
    return active[0] ? windowTitle(active[0]) : rule.name;
  }
  if (rule.kind === "category") {
    const slots = CURATED_CATEGORY_SLOTS.filter((slot) => (rule.targetIds ?? []).includes(slot.categoryId));
    if (slots.length === (rule.targetIds ?? []).length && slots.length > 0) return names(slots.map((slot) => slot.label));
  }
  return rule.name;
}

function names(items: string[]): string {
  const unique = [...new Set(items)];
  return unique.length <= 1 ? (unique[0] ?? "") : `${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}`;
}

/** The latest of the lifts' ends, or null when one has none; null when there are no lifts. */
function liftState(lifts: { until: string | null; by: Actor }[]): GroupLiftState | null {
  if (lifts.length === 0) return null;
  const until = lifts.some((lift) => lift.until === null) ? null : new Date(Math.max(...lifts.map((lift) => Date.parse(lift.until!)))).toISOString();
  return { until, by: lifts.find((lift) => lift.by)?.by ?? null };
}

/** The group's unblock: its rules allowed for it alone, until the last of them ends. Null when it has none. */
export function groupUnblock(group: Pick<Group, "id">, rules: Rule[], now: Date): GroupLiftState | null {
  return liftState(
    groupScopedRules(rules, group.id)
      .filter((rule) => rule.enabled)
      .flatMap((rule) => {
        const lift = groupLift(rule, group.id, now);
        return lift?.kind === "allow" ? [lift] : [];
      }),
  );
}

/**
 * The pause a rule area has for the group: every one of its rules that applies paused for this
 * group alone. Null when one still applies, or when the rules are lifted another way (an unblock).
 */
export function groupRulePause(group: Pick<Group, "id">, zoneRules: Rule[], now: Date): GroupLiftState | null {
  const applying = zoneRules.filter((rule) => rule.enabled && !rulePaused(rule, now));
  const lifts = applying.map((rule) => groupLift(rule, group.id, now));
  if (applying.length === 0 || lifts.some((lift) => lift?.kind !== "pause")) return null;
  return liftState(lifts as { until: string | null; by: Actor }[]);
}

export type GroupStatus = {
  /** Paused: the group's own block. Off: an internet rule blocks it. Rule: it is online but a category, app or website rule blocks part of it. */
  tone: "paused" | "off" | "rule" | "on";
  label: string;
};

/**
 * What a card's status line says the group is doing now: blocked, which rule blocks it, an
 * unblock, or (with nothing of the kind) its internet schedule.
 */
export function groupStatus(group: Group, rules: Rule[], timezone: string, now: Date): GroupStatus {
  const by = (actor: Actor) => (actor ? ` by ${actor.name}` : "");
  const until = (at: string | null, open: string) => (at ? `until ${formatClock(new Date(at), timezone)}` : open);
  if (group.suspension.active) {
    const { until: end, by: who } = group.suspension;
    return { tone: "paused", label: end ? `Blocked ${until(end, "")}${by(who)}` : `Blocked${by(who)} until you unblock` };
  }
  const blocking = rulesBlockingGroup(group, rules, timezone, now);
  const internet = blocking.find((rule) => rule.kind === "internet");
  if (internet) return { tone: "off", label: `Blocked · ${internet.name} ${until(internet.until, "· always")}` };
  if (blocking.length) {
    const last = blocking[0]!.until;
    return { tone: "rule", label: `Online · ${names(blocking.map((rule) => rule.name))} blocked${last ? ` ${until(last, "")}` : ""}` };
  }
  const unblock = groupUnblock(group, rules, now);
  if (unblock) {
    const label = unblock.until ? `Online · unblocked ${until(unblock.until, "")}${by(unblock.by)}` : `Online · unblocked${by(unblock.by)} until you resume`;
    return { tone: "on", label };
  }
  const internetRules = groupScopedRules(rules, group.id).filter((rule) => rule.kind === "internet");
  const paused = groupRulePause(group, internetRules, now);
  if (paused) return { tone: "on", label: `Online · internet rule paused ${until(paused.until, "until you resume")}` };
  return { tone: "on", label: cardStateLabel(group, internetWindowsForGroup(rules, group.id, now), timezone, now) };
}

/**
 * The group's one header button, and its More time link while a timed block or unblock lasts.
 * Block blocks all internet; Unblock lifts whatever blocks it now (at once when only its own block
 * does, otherwise from a sheet); Resume ends an unblock.
 */
export function groupHeaderActions(
  group: Group,
  rules: Rule[],
  timezone: string,
  now: Date,
): { action: GroupActionSpec; more: GroupActionSpec | null } {
  const blocking = rulesBlockingGroup(group, rules, timezone, now);
  if (group.suspension.active) {
    return {
      action: { label: "Unblock", run: blocking.length ? "unblock" : "unblockNow" },
      more: group.suspension.until ? { label: "More time", run: "moreBlock" } : null,
    };
  }
  if (blocking.length) return { action: { label: "Unblock", run: "unblock" }, more: null };
  const unblock = groupUnblock(group, rules, now);
  if (unblock) return { action: { label: "Resume", run: "resume" }, more: unblock.until ? { label: "More time", run: "moreUnblock" } : null };
  return { action: { label: "Block", run: "block" }, more: null };
}

/**
 * A rule area's button for the card's group (its internet rules, or the focused category's rule),
 * and its More time link while a timed pause lasts. Nothing while the group is blocked, while
 * its unblock lifts the rules, or when none of them applies.
 */
export function groupRuleActions(
  group: Group,
  zoneRules: Rule[],
  now: Date,
): { action: GroupRuleActionSpec | null; more: GroupRuleActionSpec | null } {
  const none = { action: null, more: null };
  if (group.suspension.active) return none;
  const applying = zoneRules.filter((rule) => rule.enabled && !rulePaused(rule, now));
  if (applying.length === 0) return none;
  const paused = groupRulePause(group, zoneRules, now);
  if (paused) return { action: { label: "Resume", run: "resume" }, more: paused.until ? { label: "More time", run: "extend" } : null };
  if (applying.some((rule) => groupLift(rule, group.id, now)?.kind === "allow")) return none;
  return { action: { label: "Pause", run: "pause" }, more: null };
}

/** The `--ff-*` colour a status line is drawn in. */
export function groupStatusColor(tone: GroupStatus["tone"]): string {
  if (tone === "paused") return "var(--ff-paused)";
  if (tone === "off") return "var(--ff-accent)";
  if (tone === "rule") return "var(--ff-verdict-rule-ink)";
  return "var(--ff-on)";
}

/** A group's built-in rule, "this group has internet": pausing it blocks all internet. */
export function internetRulePath(group: Pick<Group, "id">): string {
  return `/api/v1/groups/${group.id}/rules/internet`;
}
