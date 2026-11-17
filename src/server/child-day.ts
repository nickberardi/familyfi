import { AccountKind, RuleMode } from "@prisma/client";
import type { MeDay } from "@/lib/child-day";
import { prisma } from "./db";
import { blockRuleOf, groupInclude, lifted, publicGroup } from "./groups";
import { currentTimezone } from "./household";
import { ApiError } from "./http";
import { builtInRule } from "./rules";

/**
 * Who a child is told paused them: the person as they were named then. The recovery account is no
 * person, so it goes unnamed, and FamilyFi Me says the pause without a name.
 */
async function childFacingName(by: { accountId: string | null; name: string } | null): Promise<string | null> {
  if (!by) return null;
  if (by.accountId) {
    const account = await prisma().account.findUnique({ where: { id: by.accountId }, select: { kind: true } });
    if (account?.kind === AccountKind.recovery) return null;
  }
  return by.name;
}

/**
 * A child's own day, for FamilyFi Me (`GET /api/v1/me/day`): the group its phone signs in for, and
 * nothing else in the household. Its pause, its allowance, the windows of its internet rules that
 * are on, and the rules that block something all the time. A rule paused or allowed, for everyone or
 * for this group, blocks nothing while it is lifted: a scheduled internet rule lifted until a time
 * keeps its windows, marked `allowed` until then, so the child is told when they come back, and an
 * always-on rule lifted until a time is marked the same way; one lifted with no end is left out.
 */
export async function childDay(groupId: string | null, now = new Date()): Promise<MeDay> {
  const group = groupId ? await prisma().group.findUnique({ where: { id: groupId }, include: groupInclude }) : null;
  // The guard refuses a child's phone whose group is gone, so this is only a race with its deletion.
  if (!group) throw new ApiError(404, "not_found", "Group not found.");
  const timezone = await currentTimezone();
  const shown = publicGroup(group, timezone, now);
  const block = blockRuleOf(group);
  const links = group.rules
    .filter(({ rule }) => rule.enabled && rule.systemGroupId === null && builtInRule(rule) === null)
    .sort((a, b) => a.rule.createdAt.getTime() - b.rule.createdAt.getTime());
  // How long a rule is lifted for this group, for everyone or for it alone: the later end, null
  // when it has none; undefined when it is not lifted.
  const liftOf = (link: (typeof links)[number]) => {
    const lifts = [link.rule, link].filter((state) => lifted(state, now));
    if (!lifts.length) return undefined;
    if (lifts.some((state) => state.pauseUntil === null)) return null;
    return lifts.reduce((a, b) => (a.pauseUntil!.getTime() >= b.pauseUntil!.getTime() ? a : b));
  };
  const scheduled = links.filter((link) => link.rule.kind === "internet" && link.rule.mode === RuleMode.scheduled && liftOf(link) !== null);
  const windows = await Promise.all(
    scheduled.map(async (link) => {
      const lift = liftOf(link);
      const allowed = lift
        ? { by: await childFacingName(lift.pausedByName ? { accountId: lift.pausedByAccountId, name: lift.pausedByName } : null), until: lift.pauseUntil!.toISOString() }
        : null;
      return [...link.rule.windows]
        .sort((a, b) => a.position - b.position)
        .map((window) => ({ ruleId: link.rule.id, ruleName: link.rule.name, name: window.name, days: [...window.days].sort((a, b) => a - b), start: window.start, end: window.end, allowed }));
    }),
  );
  return {
    group: { id: group.id, name: group.name },
    timezone,
    pause: shown.suspension.active && block
      // Only starting, extending and ending a pause write the block rule's row (group-internet.ts,
      // group-unblock.ts), so its last update is when the pause was last set.
      ? { by: await childFacingName(shown.suspension.by), since: block.updatedAt.toISOString(), until: shown.suspension.until }
      : null,
    allowance: shown.allowance.active ? { by: await childFacingName(shown.allowance.by), until: shown.allowance.until } : null,
    windows: windows.flat(),
    alwaysOn: await Promise.all(
      links
        .filter((link) => link.rule.mode === RuleMode.always && liftOf(link) !== null)
        .map(async (link) => {
          const lift = liftOf(link);
          const allowed = lift
            ? { by: await childFacingName(lift.pausedByName ? { accountId: lift.pausedByAccountId, name: lift.pausedByName } : null), until: lift.pauseUntil!.toISOString() }
            : null;
          return { ruleId: link.rule.id, name: link.rule.name, kind: link.rule.kind, allowed };
        }),
    ),
  };
}
