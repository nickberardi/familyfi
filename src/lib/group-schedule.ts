import type { TimelineBand } from "./day-timeline";
import { daysLabel, formatClock, windowTimes } from "./display";
import { groupRuleActions, rulesBlockingGroup, type GroupRuleActionSpec } from "./group-actions";
import { isWindowActive, localWeekday, windowDayBands, windowTitle, type InternetWindow } from "./rule-windows";
import { CURATED_CATEGORY_SLOTS, groupLift, groupScopedRules, parentFacingRuleLabel, ruleInternetWindows, rulePaused, type Rule } from "./rules";
import type { Group } from "./types";

/*
 * A group's schedule, as its card and its details page show it: every rule that applies to it on
 * one 24-hour bar, and a list of what is scheduled. The card lists today's windows in time order;
 * the details page lists each rule once with its Pause or Resume, since a pause lifts a whole rule
 * for the group, never one window of it. Internet rules keep the accent blue; every other rule
 * takes the next of the schedule colours (`tone`), in the order the group's rules were made.
 */

/** How many schedule colours there are: `--ff-schedule-1-*` to `--ff-schedule-5-*`. */
export const SCHEDULE_TONES = 5;

/** A rule on a group's schedule: what it is called there, and its colour (null: the internet's blue). */
export type ScheduleRule = { rule: Rule; title: string; tone: number | null };

/** One window today, on the card's list. */
export type ScheduleWindowRow = {
  key: string;
  ruleId: string;
  tone: number | null;
  /** The window's name for an internet rule ("Overnight"); the rule's title otherwise ("Video"). */
  title: string;
  /** "no internet 10 PM–7 AM", "blocked 4 PM–6 PM". */
  detail: string;
  /** "Now" while it blocks the group, how it is lifted while it is, else null. */
  state: string | null;
  live: boolean;
};

/** One rule, on the details page's list, with what its button does for the group. */
export type ScheduleRuleRow = {
  ruleId: string;
  tone: number | null;
  title: string;
  /** Its windows: "Dinner 6 PM–8 PM, Overnight 10 PM–7 AM", with the days when not every day. */
  times: string;
  state: string | null;
  live: boolean;
  action: GroupRuleActionSpec | null;
  more: GroupRuleActionSpec | null;
};

/** The group's own rules that are on, oldest first, each with its title and colour. */
export function groupScheduleRules(group: Pick<Group, "id">, rules: Rule[], catalogNames: Map<string, string>): ScheduleRule[] {
  let next = 0;
  return groupScopedRules(rules, group.id)
    .filter((rule) => rule.enabled && rule.builtIn === null)
    .map((rule) => ({ rule, title: scheduleTitle(rule, catalogNames), tone: rule.kind === "internet" ? null : next++ % SCHEDULE_TONES }));
}

/**
 * What a rule is called on a schedule: an internet rule by its name, a single category or app by
 * what it blocks ("Video"), and a rule over several by its name and what it blocks
 * ("Homework (Video and Social)").
 */
function scheduleTitle(rule: Rule, catalogNames: Map<string, string>): string {
  if (rule.kind === "internet" || rule.kind === "domain") return rule.name;
  if (rule.targetIds.length > 1) {
    const blocked = rule.targetIds.map(
      (id) =>
        (rule.kind === "category" ? CURATED_CATEGORY_SLOTS.find((slot) => slot.categoryId === id)?.label : undefined) ??
        catalogNames.get(`${rule.kind}:${id}`) ??
        null,
    );
    return blocked.every(Boolean) ? `${rule.name} (${andList(blocked as string[])})` : rule.name;
  }
  const label = parentFacingRuleLabel(rule, catalogNames);
  return label === "Category" || label === "App" ? rule.name : label;
}

function andList(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** How a rule is lifted for the group now, in words, or null when it is not. */
function liftLabel(group: Pick<Group, "id">, rule: Rule, timezone: string, now: Date): string | null {
  const until = (at: string | null, open: string) => (at ? `until ${formatClock(new Date(at), timezone)}` : open);
  if (rulePaused(rule, now)) return `Paused for everyone ${until(rule.pause.until, "until resumed")}`;
  const lift = groupLift(rule, group.id, now);
  if (!lift) return null;
  return lift.kind === "allow" ? `Unblocked ${until(lift.until, "until you resume")}` : `Paused ${until(lift.until, "until you resume")}`;
}

/**
 * Today's schedule for the group: its bands on the bar, and its windows today in the order they
 * start. Rules that block always are left out. A rule that is lifted for the group now draws faintly and says how in its rows.
 */
export function groupScheduleToday(
  group: Pick<Group, "id" | "suspension">,
  rules: Rule[],
  catalogNames: Map<string, string>,
  timezone: string,
  now: Date,
): { bands: TimelineBand[]; rows: ScheduleWindowRow[] } {
  const weekday = localWeekday(now, timezone);
  const blocking = new Set(rulesBlockingGroup(group, rules, timezone, now).map((item) => item.ruleId));
  const bands: TimelineBand[] = [];
  const rows: (ScheduleWindowRow & { start: number })[] = [];
  for (const { rule, title, tone } of groupScheduleRules(group, rules, catalogNames)) {
    // Only scheduled windows: a rule that blocks all day, every day, is in the status line and on
    // the details page, not on the day's schedule.
    if (rule.mode === "always") continue;
    const internet = rule.kind === "internet";
    const lifted = liftLabel(group, rule, timezone, now);
    ruleInternetWindows(rule).forEach((window, index) => {
      const today = windowDayBands(window, weekday);
      if (today.length === 0) return;
      const name = internet ? windowTitle(window) : title;
      for (const band of today) {
        bands.push({
          kind: internet ? "window" : "category",
          from: band.from,
          to: band.to,
          label: internet ? name : `${title} blocked`,
          source: lifted ? `${rule.name} rule · ${lifted.toLowerCase()}` : `${rule.name} rule`,
          ...(tone === null ? {} : { tone }),
          ...(lifted ? { dim: true } : {}),
        });
      }
      const live = !lifted && blocking.has(rule.id) && isWindowActive(window, now, timezone);
      rows.push({
        key: `${rule.id}:${index}`,
        ruleId: rule.id,
        tone,
        title: name,
        detail: `${internet ? "no internet" : "blocked"} ${windowSpan(window)}`,
        state: lifted ?? (live ? "Now" : null),
        live,
        start: startMinutes(window),
      });
    });
  }
  rows.sort((a, b) => a.start - b.start);
  return { bands, rows: rows.map((row) => ({ key: row.key, ruleId: row.ruleId, tone: row.tone, title: row.title, detail: row.detail, state: row.state, live: row.live })) };
}

/** Every rule on the group's schedule, once each, with its Pause or Resume for the group. */
export function groupScheduleRuleRows(
  group: Group,
  rules: Rule[],
  catalogNames: Map<string, string>,
  timezone: string,
  now: Date,
): ScheduleRuleRow[] {
  const blocking = new Set(rulesBlockingGroup(group, rules, timezone, now).map((item) => item.ruleId));
  return groupScheduleRules(group, rules, catalogNames).map(({ rule, title, tone }) => {
    const lifted = liftLabel(group, rule, timezone, now);
    const live = !lifted && blocking.has(rule.id);
    const { action, more } = groupRuleActions(group, [rule], now);
    const windows = ruleInternetWindows(rule);
    // A window named like its rule ("Homework" in Homework) says nothing its title does not.
    const named = (window: InternetWindow) => (window.name.trim() && window.name.trim() !== rule.name.trim() ? `${window.name.trim()} ` : "");
    const times = windows.map((window) => `${named(window)}${windowSpan(window)}`).join(", ");
    const days = rule.mode === "always" ? "Every day" : daysLabel(windows.flatMap((window) => window.days));
    return {
      ruleId: rule.id,
      tone,
      title,
      times: days === "Every day" ? times : `${times} · ${days}`,
      state: lifted ?? (live ? "Now" : null),
      live,
      action,
      more,
    };
  });
}

function windowSpan(window: InternetWindow): string {
  return window.always ? "all day" : windowTimes(window.start, window.end);
}

function startMinutes(window: InternetWindow): number {
  const [hours, minutes] = window.start.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}
