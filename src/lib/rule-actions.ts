import { formatClock } from "./display";
import { rulePaused, type Rule } from "./rules";

/**
 * A rule card action as plain data, like a group's: `run` names what a tap does.
 * familyfi-mobile shows it through the shared rule card, and `tests/fixtures/display-vectors.json` pins it.
 */
export type RuleActionSpec = {
  label: string;
  strong?: boolean;
  run: "pause" | "resume" | "extend" | "allow" | "disallow";
};

/**
 * What an adult can do to a rule now, for every group it covers: Pause for everyone lifts it
 * until a time (its sheet offers until the windows active now end), Resume brings it back. A pause
 * means nothing while the rule is off. A group's own pause of the rule is on the group's card.
 */
export function ruleActionSpecs(rule: Rule, _timezone: string, now: Date): RuleActionSpec[] {
  if (!rule.enabled) return [];
  if (!rulePaused(rule, now)) return [{ label: "Pause for everyone", run: "pause" }];
  // An allowance made before allow left the rule card ends the same way a pause does.
  if (rule.pause.kind === "allow") return [{ label: "Resume", strong: true, run: "disallow" }];
  return [{ label: "Resume", strong: true, run: "resume" }, ...(rule.pause.until ? [{ label: "More time", run: "extend" } as const] : [])];
}

/** The line a paused rule's card shows, "Paused until 1:30 AM by Nick"; null when it is not paused. */
export function ruleStateLine(rule: Pick<Rule, "pause">, timezone: string, now: Date): string | null {
  if (!rulePaused(rule, now)) return null;
  const allowed = rule.pause.kind === "allow";
  const until = rule.pause.until ? `until ${formatClock(new Date(rule.pause.until), timezone)}` : allowed ? "until you resume the schedule" : "until resumed";
  return `${allowed ? "Allowed" : "Paused"} ${until}${rule.pause.by ? ` by ${rule.pause.by.name}` : ""}`;
}

/**
 * One line per group the rule is lifted for alone, "Paused for Emma until 8:00 PM" or "Unblocked
 * for Emma until 6:00 PM"; empty
 * when there are none. `groupNames` maps a group id to its name.
 */
export function ruleGroupStateLines(
  rule: Pick<Rule, "groupPauses"> & Partial<Pick<Rule, "builtIn">>,
  groupNames: Record<string, string>,
  timezone: string,
  now: Date,
): string[] {
  return rule.groupPauses
    .filter((item) => rulePaused({ pause: item.pause }, now))
    .map((item) => {
      // A group's allowance on a rule is its unblock; Lock DNS never blocked the group, so it is allowed.
      const verb = item.pause.kind === "allow" ? (rule.builtIn === "dns" ? "Allowed" : "Unblocked") : "Paused";
      const until = item.pause.until ? `until ${formatClock(new Date(item.pause.until), timezone)}` : "until resumed";
      return `${verb} for ${groupNames[item.groupId] ?? "a deleted group"} ${until}${item.pause.by ? ` by ${item.pause.by.name}` : ""}`;
    });
}
