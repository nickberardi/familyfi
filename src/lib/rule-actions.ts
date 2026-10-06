import { formatClock } from "./display";
import { isWindowActive } from "./rule-windows";
import { rulePaused, ruleInternetWindows, type Rule } from "./rules";

/**
 * A rule card action as plain data, like a group's: `run` names what a tap does. The
 * native iOS app ports this, and `tests/fixtures/display-vectors.json` pins it.
 */
export type RuleActionSpec = {
  label: string;
  strong?: boolean;
  run: "pause" | "resume" | "extend" | "allow" | "disallow";
};

/**
 * What an adult can do to a rule now. Pausing lifts the rule for every group it covers
 * until a time, so it means nothing while the rule is off.
 */
export function ruleActionSpecs(rule: Rule, timezone: string, now: Date): RuleActionSpec[] {
  if (!rule.enabled) return [];
  // Quarantine blocks around the clock: it is paused, never allowed.
  if (rule.builtIn === "quarantine" && !rulePaused(rule, now)) return [{ label: "Pause rule", run: "pause" }];
  if (rulePaused(rule, now) && rule.pause.kind === "allow") {
    return [{ label: "Resume schedule", strong: true, run: "disallow" }, { label: "Pause rule", run: "pause" }];
  }
  if (rulePaused(rule, now)) {
    return [
      { label: "Resume rule", strong: true, run: "resume" },
      ...(rule.pause.until ? [{ label: "More time", run: "extend" } as const] : []),
    ];
  }
  if (ruleInternetWindows(rule).some((window) => isWindowActive(window, now, timezone))) {
    return [{ label: "Allow now", strong: true, run: "allow" }, { label: "Pause rule", run: "pause" }];
  }
  return [{ label: "Pause rule", run: "pause" }];
}

/** The line a paused rule's card shows, "Paused until 1:30 AM by Nick"; null when it is not paused. */
export function ruleStateLine(rule: Pick<Rule, "pause">, timezone: string, now: Date): string | null {
  if (!rulePaused(rule, now)) return null;
  const allowed = rule.pause.kind === "allow";
  const until = rule.pause.until ? `until ${formatClock(new Date(rule.pause.until), timezone)}` : allowed ? "until you resume the schedule" : "until resumed";
  return `${allowed ? "Allowed" : "Paused"} ${until}${rule.pause.by ? ` by ${rule.pause.by.name}` : ""}`;
}

/**
 * One line per group the rule is lifted for alone, "Paused for Emma until 8:00 PM"; empty
 * when there are none. `groupNames` maps a group id to its name.
 */
export function ruleGroupStateLines(
  rule: Pick<Rule, "groupPauses">,
  groupNames: Record<string, string>,
  timezone: string,
  now: Date,
): string[] {
  return rule.groupPauses
    .filter((item) => rulePaused({ pause: item.pause }, now))
    .map((item) => {
      const line = ruleStateLine({ pause: item.pause }, timezone, now)!;
      const at = line.indexOf(" ");
      return `${line.slice(0, at)} for ${groupNames[item.groupId] ?? "a deleted group"}${line.slice(at)}`;
    });
}
