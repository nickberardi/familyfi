import { RuleLiftKind } from "@prisma/client";
import { COUNTRIES_RULE_ID, LOCK_DNS_RULE_ID } from "@/lib/rules";
import { extendSuspensionUntil } from "@/lib/schedule";
import { answerAsks, endEarlierUnblockYes } from "./asks";
import { enqueueChange } from "./changes";
import { prisma } from "./db";
import { BREAK_CLEARED, groupInclude, lifted, publicGroup, sessionActor } from "./groups";
import { ApiError } from "./http";
import { CLEARED, readLiftBody, type LiftBody } from "./rule-lifts";
import { presentRules, ruleInclude } from "./rules";
import { unblockTargets } from "./unblock-targets";
import { currentHouseholdId } from "./household-context";

export type UnblockAction = "unblock" | "end" | "extend";

const BLOCK_CLEARED = { enabled: false, expiresAt: null, blockedByAccountId: null, blockedByName: null, ...BREAK_CLEARED };

/**
 * Unblocks a group: whatever blocks it now stops, for this group alone, whichever kind of rule
 * it is, except an always-on category, app or website rule (`standingRule`), which stays on. The group's own pause ends, and each rule blocking it now is allowed for the group until
 * its active windows end, or every rule it has until `until`. An allowance, one per rule, so its
 * devices leave the rule's policies and the rule itself is untouched. `end` and `extend` act on
 * those allowances together: `extend` gives each timed one the same new end, the latest plus `minutes`. Returns `{ group, rules, change }`, `rules` being the group's own.
 * `body` is what `readUnblockBody` read.
 */
export async function unblockGroup(
  session: Parameters<typeof sessionActor>[0],
  action: UnblockAction,
  groupId: string,
  body: LiftBody,
) {
  const existing = await prisma().group.findUnique({ where: { id: groupId }, include: groupInclude });
  if (!existing) throw new ApiError(404, "not_found", "Group not found.");
  const household = await prisma().household.findUniqueOrThrow({ where: { id: currentHouseholdId() } });
  const now = new Date();
  const { links, blockedByPause, candidates, ends } = unblockTargets(existing, now, household.timezone);
  const allowances = links.filter((link) => link.pauseKind === RuleLiftKind.allow && lifted(link, now));

  if (action === "unblock") {
    const requested = body.until ? new Date(body.until) : null;
    if (requested && requested.getTime() <= now.getTime()) throw new ApiError(400, "invalid_request", "until must be in the future.");
    // By default only the rules blocking now, each until its own windows end; given a time, every rule.
    const targets = candidates.filter(({ rule }) => body.until !== undefined || ends.get(rule.id) !== undefined);
    if (targets.length === 0 && !blockedByPause) throw new ApiError(409, "not_blocked", "Nothing is blocking this group now.");
    const actor = sessionActor(session);
    await prisma().$transaction(async (tx) => {
      for (const { rule } of targets) {
        await tx.ruleGroup.update({
          where: { ruleId_groupId: { ruleId: rule.id, groupId } },
          data: {
            pauseActive: true,
            pauseUntil: body.until === undefined ? (ends.get(rule.id) ?? null) : requested,
            pauseKind: RuleLiftKind.allow,
            pausedByAccountId: actor.accountId,
            pausedByName: actor.name,
          },
        });
      }
      await tx.rule.updateMany({ where: { systemGroupId: groupId, enabled: true }, data: BLOCK_CLEARED });
    });
    // A newer unblock: an earlier yes to unblock is over. Whatever a child asked about that this
    // unblock lifted is answered yes: an ask to unblock once nothing blocks the group, and an ask
    // for time off a rule it lifted.
    if (blockedByPause || targets.some(({ rule }) => rule.id === existing.blockButtonRuleId)) await endEarlierUnblockYes(groupId);
    await answerAsks(session, groupId, { pause: blockedByPause || targets.length > 0, ruleIds: targets.map(({ rule }) => rule.id) });
  } else if (action === "end") {
    if (body.until !== undefined) throw new ApiError(400, "invalid_request", "Ending an unblock takes no time.");
    const ended = await prisma().ruleGroup.updateMany({
      where: { groupId, rule: { systemGroupId: null }, ruleId: { notIn: [LOCK_DNS_RULE_ID, COUNTRIES_RULE_ID] }, pauseActive: true, pauseKind: RuleLiftKind.allow },
      data: CLEARED,
    });
    // A pause's break (a yes to a child's ask) ends too: the pause blocks again at once.
    const unbroken = await prisma().rule.updateMany({ where: { systemGroupId: groupId, enabled: true, pauseActive: true }, data: BREAK_CLEARED });
    if (ended.count || unbroken.count) await endEarlierUnblockYes(groupId);
  } else {
    if (allowances.length === 0) throw new ApiError(409, "not_unblocked", "Extend requires an active unblock.");
    const timed = allowances.filter((link) => link.pauseUntil !== null);
    if (timed.length === 0) throw new ApiError(409, "indefinite", "An unblock with no end time has no expiry to extend.");
    // More time counts from the unblock's end, its latest allowance, as the sheet does; every
    // timed allowance then lasts until that one new time, so the group blocks again all at once.
    const latest = new Date(Math.max(...timed.map((link) => link.pauseUntil!.getTime())));
    const until = extendSuspensionUntil(latest, now, body.minutes! * 60_000);
    await prisma().ruleGroup.updateMany({
      where: { groupId, ruleId: { in: timed.map((link) => link.ruleId) } },
      data: { pauseUntil: until },
    });
  }

  const fresh = await prisma().group.findUniqueOrThrow({ where: { id: groupId }, include: groupInclude });
  const rules = await prisma().rule.findMany({
    where: { systemGroupId: null, groups: { some: { groupId } } },
    include: ruleInclude,
    orderBy: { createdAt: "asc" },
  });
  const change = await enqueueChange(action === "extend" ? "extend" : "unblock");
  return { group: publicGroup(fresh, household.timezone, now), rules: await presentRules(rules), change };
}

/** The request body an unblock verb takes: an optional `until` to unblock, `minutes` to extend, none to end. */
export function readUnblockBody(request: Request, action: UnblockAction) {
  return readLiftBody(request, action === "unblock" ? "allow" : action === "extend" ? "extend" : "resume");
}
