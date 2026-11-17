import { RuleLiftKind, RuleMode } from "@prisma/client";
import type { MeDay } from "@/lib/child-day";
import { prisma } from "./db";
import { blockRuleOf, groupInclude, lifted, publicGroup } from "./groups";
import { currentTimezone } from "./household";
import { ApiError } from "./http";
import { builtInRule } from "./rules";

function pausedNow(state: { pauseActive: boolean; pauseUntil: Date | null; pauseKind: RuleLiftKind }, now: Date) {
  return state.pauseKind === RuleLiftKind.pause && lifted(state, now);
}

/**
 * A child's own day, for FamilyFi Me (`GET /api/v1/me/day`): the group its phone signs in for, and
 * nothing else in the household. Its pause, its allowance, the windows of its internet rules that
 * are on, and the rules that block something all the time. A rule paused for everyone or for this
 * group is left out while it is paused; an allowance is reported as itself, and its windows stay.
 */
export async function childDay(groupId: string | null, now = new Date()): Promise<MeDay> {
  const group = groupId ? await prisma().group.findUnique({ where: { id: groupId }, include: groupInclude }) : null;
  // The guard refuses a child's phone whose group is gone, so this is only a race with its deletion.
  if (!group) throw new ApiError(404, "not_found", "Group not found.");
  const timezone = await currentTimezone();
  const shown = publicGroup(group, timezone, now);
  const block = blockRuleOf(group);
  const covering = group.rules
    .filter(({ rule }) => rule.enabled && rule.systemGroupId === null && builtInRule(rule) === null)
    // A pause lifts a rule; an allowance is the group's own, told by `allowance`.
    .filter((link) => !pausedNow(link.rule, now) && !pausedNow(link, now))
    .map((link) => link.rule)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return {
    group: { id: group.id, name: group.name },
    timezone,
    pause: shown.suspension.active && block
      ? { by: shown.suspension.by?.name ?? null, since: block.updatedAt.toISOString(), until: shown.suspension.until }
      : null,
    allowance: shown.allowance.active ? { by: shown.allowance.by?.name ?? null, until: shown.allowance.until } : null,
    windows: covering
      .filter((rule) => rule.kind === "internet" && rule.mode === RuleMode.scheduled)
      .flatMap((rule) =>
        [...rule.windows]
          .sort((a, b) => a.position - b.position)
          .map((window) => ({ ruleId: rule.id, ruleName: rule.name, name: window.name, days: [...window.days].sort((a, b) => a - b), start: window.start, end: window.end })),
      ),
    alwaysOn: covering.filter((rule) => rule.mode === RuleMode.always).map((rule) => ({ ruleId: rule.id, name: rule.name, kind: rule.kind })),
  };
}
