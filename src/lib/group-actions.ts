import { cardStateLabel, formatClock } from "./display";
import { internetState, isWindowActive, windowEndsAt, windowTitle } from "./rule-windows";
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
 * whatever is blocking it now, of any kind, except an always-on category, app or website rule,
 * which is how the group is set up rather than a block on it. A single rule under a group is
 * paused and resumed, for that group alone, from the card's dropdown or the group's page. Either
 * way the rule itself never changes, and a place shows one button for its state, never its
 * opposite beside it.
 */

/** What a tap on the group's header button, or its More time link, does. */
export type GroupRun = "block" | "moreBlock" | "unblock" | "unblockNow" | "resume" | "moreUnblock";

export type GroupActionSpec = { label: string; run: GroupRun };

/** A choice in the dropdown beside the card's Block or Resume: pause one rule for the card's group, from its sheet. */
export type GroupMenuItem = { label: string; ruleIds: string[]; name: string };

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

/**
 * An always-on category, app or website rule: how the group is set up, not a block on it now. The
 * card's badge, line and button leave it out, and an unblock never lifts it; it is paused from the
 * card's dropdown or the group's page. An always-on internet rule blocks all internet, so it counts.
 */
export function standingRule(rule: Pick<Rule, "kind" | "mode">): boolean {
  return rule.kind !== "internet" && rule.mode === "always";
}

/** The rules blocking the group now that its Unblock lifts: `rulesBlockingGroup` without its standing rules. */
export function rulesToUnblock(group: Pick<Group, "id">, rules: Rule[], timezone: string, now: Date): BlockingRule[] {
  const standing = new Set(rules.filter(standingRule).map((rule) => rule.id));
  return rulesBlockingGroup(group, rules, timezone, now).filter((rule) => !standing.has(rule.ruleId));
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
 * A card's status as its badge and the line under it. The badge says whether the group has the
 * internet; the line says why, in grey while its rules do what they always do, in red when someone
 * blocked it, and in green when someone lifted a block (an unblock, or its internet rule paused).
 */
export type GroupStatusParts = {
  badge: "online" | "blocked";
  /** The line under the name, or empty when the badge says it all. */
  detail: string;
  /** Who changed what the rules normally do: nobody, a block, or a lift. */
  change: "none" | "blocked" | "unblocked";
};

type FullStatus = GroupStatus & GroupStatusParts;

/**
 * What a card's status line says the group is doing now: blocked, which rule blocks it, an
 * unblock, its internet rule paused or allowed (for it, or for everyone), or (with nothing of the
 * kind) its internet schedule.
 */
export function groupStatus(group: Group, rules: Rule[], timezone: string, now: Date): GroupStatus {
  const { tone, label } = fullStatus(group, rules, timezone, now);
  return { tone, label };
}

/** The same status as `groupStatus`, as the card's badge and the line under it. */
export function groupStatusParts(group: Group, rules: Rule[], timezone: string, now: Date): GroupStatusParts {
  const { badge, detail, change } = fullStatus(group, rules, timezone, now);
  return { badge, detail, change };
}

function fullStatus(group: Group, rules: Rule[], timezone: string, now: Date): FullStatus {
  const by = (actor: Actor) => (actor ? ` by ${actor.name}` : "");
  const until = (at: string | null, open: string) => (at ? `until ${formatClock(new Date(at), timezone)}` : open);
  const online = (tone: GroupStatus["tone"], label: string, detail: string, change: GroupStatusParts["change"] = "none"): FullStatus => ({
    tone,
    label,
    badge: "online",
    detail: sentence(detail),
    change,
  });
  const blocked = (tone: GroupStatus["tone"], label: string, detail: string, change: GroupStatusParts["change"] = "none"): FullStatus => ({
    tone,
    label,
    badge: "blocked",
    detail: sentence(detail),
    change,
  });
  if (group.suspension.active) {
    const { until: end, by: who } = group.suspension;
    return end
      ? blocked("paused", `Blocked ${until(end, "")}${by(who)}`, `${until(end, "")}${by(who)}`, "blocked")
      : blocked("paused", `Blocked${by(who)} until you unblock`, who ? `until you unblock, by ${who.name}` : "until you unblock", "blocked");
  }
  const blocking = rulesToUnblock(group, rules, timezone, now);
  const internet = blocking.find((rule) => rule.kind === "internet");
  if (internet) {
    const detail = `${internet.name} ${until(internet.until, "· always")}`;
    return blocked("off", `Blocked · ${detail}`, detail);
  }
  if (blocking.length) {
    const last = blocking[0]!.until;
    const detail = `${names(blocking.map((rule) => rule.name))} blocked${last ? ` ${until(last, "")}` : ""}`;
    return online("rule", `Online · ${detail}`, detail);
  }
  const unblock = groupUnblock(group, rules, now);
  if (unblock) {
    const detail = unblock.until ? `unblocked ${until(unblock.until, "")}${by(unblock.by)}` : `unblocked${by(unblock.by)} until you resume`;
    return online("on", `Online · ${detail}`, detail, "unblocked");
  }
  const internetRules = groupScopedRules(rules, group.id).filter((rule) => rule.kind === "internet");
  const paused = groupRulePause(group, internetRules, now);
  if (paused) {
    const detail = `internet rule paused ${until(paused.until, "until you resume")}`;
    return online("on", `Online · ${detail}`, detail, "unblocked");
  }
  const windows = internetWindowsForGroup(rules, group.id, now);
  const pausedForEveryone = internetRules.find((rule) => rule.enabled && rulePaused(rule, now));
  if (pausedForEveryone && windows.length === 0) {
    const verb = pausedForEveryone.pause.kind === "allow" ? "allowed" : "paused";
    const detail = `internet rule ${verb} for everyone ${until(pausedForEveryone.pause.until, "until you resume")}`;
    return online("on", `Online · ${detail}`, detail, "unblocked");
  }
  // Nothing blocks or lifts a rule for the group: its internet schedule, as cardStateLabel names it.
  const label = cardStateLabel(group, windows, timezone, now);
  const state = internetState(group, windows, now, timezone);
  switch (state.state) {
    case "blocked":
      return blocked("on", label, `${state.window} ${until(state.until, "· always")}`);
    case "allowed":
      return online("on", label, `allowed ${until(state.until, "until you resume the schedule")}${by(state.by)}`, "unblocked");
    case "online":
      return online("on", label, state.next ? `${state.next.window} at ${formatClock(new Date(state.next.at), timezone)}` : "");
    case "no_rule":
      return online("on", label, group.internetRuleIds.length === 0 ? "no internet rule" : "internet rule off");
    default:
      // A pause is the group's suspension, handled first.
      return online("on", label, "");
  }
}

/** The line under a card's name starts like a sentence. */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The `--ff-*` colour a status line is drawn in. */
export function groupStatusColor(tone: GroupStatus["tone"]): string {
  if (tone === "paused") return "var(--ff-paused)";
  if (tone === "off") return "var(--ff-accent)";
  if (tone === "rule") return "var(--ff-verdict-rule-ink)";
  return "var(--ff-on)";
}

/** The badge beside a card's name: its word, and the `--ff-*` ink and fill it is drawn in. */
export function groupBadge(badge: GroupStatusParts["badge"]): { label: string; ink: string; fill: string } {
  if (badge === "blocked") return { label: "Blocked", ink: "var(--ff-status-blocked-ink)", fill: "var(--ff-status-blocked-fill)" };
  return { label: "Online", ink: "var(--ff-status-online-ink)", fill: "var(--ff-status-online-fill)" };
}

/** The `--ff-*` colour of the line under a card's name: grey, or the colour of the change someone made. */
export function groupDetailColor(change: GroupStatusParts["change"]): string {
  if (change === "blocked") return "var(--ff-status-blocked-ink)";
  if (change === "unblocked") return "var(--ff-status-online-ink)";
  return "var(--ff-ink-2)";
}

/**
 * The group's one header button, its More time link while a timed block or unblock lasts, and,
 * while the group has the internet, a dropdown pausing each category, app or website rule blocking
 * part of it now, scheduled ones first. Block blocks all internet; Unblock lifts whatever blocks it
 * now but its standing rules (at once when only its own block does, otherwise from a sheet); Resume
 * ends an unblock.
 */
export function groupHeaderActions(
  group: Group,
  rules: Rule[],
  timezone: string,
  now: Date,
): { action: GroupActionSpec; more: GroupActionSpec | null; menu: GroupMenuItem[] } {
  const blocking = rulesToUnblock(group, rules, timezone, now);
  if (group.suspension.active) {
    return {
      action: { label: "Unblock", run: blocking.length ? "unblock" : "unblockNow" },
      more: group.suspension.until ? { label: "More time", run: "moreBlock" } : null,
      menu: [],
    };
  }
  if (blocking.some((rule) => rule.kind === "internet")) return { action: { label: "Unblock", run: "unblock" }, more: null, menu: [] };
  const menu = groupRuleMenu(group, rules, timezone, now);
  const unblock = groupUnblock(group, rules, now);
  if (unblock) return { action: { label: "Resume", run: "resume" }, more: unblock.until ? { label: "More time", run: "moreUnblock" } : null, menu };
  return { action: { label: "Block", run: "block" }, more: null, menu };
}

/** The dropdown's choices: "Pause" each category, app or website rule blocking the group now, scheduled ones first. */
function groupRuleMenu(group: Group, rules: Rule[], timezone: string, now: Date): GroupMenuItem[] {
  const partial = rulesBlockingGroup(group, rules, timezone, now).filter((rule) => rule.kind !== "internet");
  const ordered = [...partial.filter((rule) => rule.until !== null), ...partial.filter((rule) => rule.until === null)];
  return ordered.flatMap((blocking) => {
    const rule = rules.find((candidate) => candidate.id === blocking.ruleId);
    return rule ? [{ label: `Pause ${rule.name}`, ruleIds: [rule.id], name: rule.name }] : [];
  });
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

/** A group's built-in rule, "this group has internet": pausing it blocks all internet. */
export function internetRulePath(group: Pick<Group, "id">): string {
  return `/api/v1/groups/${group.id}/rules/internet`;
}
