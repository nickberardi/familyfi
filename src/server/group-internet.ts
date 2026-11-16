import { RuleKind, RuleLiftKind, RuleMode, RuleScope } from "@prisma/client";
import { extendSuspensionUntil } from "@/lib/schedule";
import { enqueueChange } from "./changes";
import { prisma } from "./db";
import { blockRuleOf, groupInclude, internetLinks, lifted, publicGroup, sessionActor } from "./groups";
import { ApiError } from "./http";
import { CLEARED, liftRule, type LiftAction, type LiftBody } from "./rule-lifts";
import { activeWindowsEnd, ruleInternetWindows } from "./rules";
import { pauseRuleName } from "./unifi/names";

/** The reserved `ruleId` for a group's built-in rule: "this group has internet". */
export const INTERNET_RULE_ID = "internet";

const BLOCK_CLEARED = { enabled: false, expiresAt: null, blockedByAccountId: null, blockedByName: null };

/**
 * The five verbs on a group's built-in `internet` rule. They do to it what they do to any
 * rule: pause, resume and extend act on a pause, allow and disallow on an allowance. Only
 * the rule's polarity differs. Pausing "has internet" blocks all internet, through the
 * group's hidden always-on block rule, enabled until `until` or until resumed. Allowing
 * overrides the group's own internet rules, one lift each. Pause and allow replace each
 * other. `body` is what `readLiftBody` read.
 */
export async function liftGroupInternet(
  session: Parameters<typeof sessionActor>[0],
  action: LiftAction,
  groupId: string,
  body: LiftBody,
) {
  const existing = await prisma().group.findUnique({ where: { id: groupId }, include: groupInclude });
  if (!existing) throw new ApiError(404, "not_found", "Group not found.");
  const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
  const now = new Date();
  const actor = sessionActor(session);
  const block = blockRuleOf(existing);
  const blocking = Boolean(block?.enabled && (block.expiresAt === null || now < block.expiresAt));
  const lifts = { groupId, rule: { kind: RuleKind.internet, systemGroupId: null } };
  const clearAllowances = () =>
    prisma().ruleGroup.updateMany({ where: { ...lifts, pauseActive: true, pauseKind: RuleLiftKind.allow }, data: CLEARED });

  const until = (requested: string | null | undefined): Date | null => {
    const value = requested ? new Date(requested) : null;
    if (value && value.getTime() <= now.getTime()) throw new ApiError(400, "invalid_request", "until must be in the future.");
    return value;
  };

  if (action === "pause") {
    const end = until(body.until);
    const fields = { enabled: true, expiresAt: end, blockedByAccountId: actor.accountId, blockedByName: actor.name };
    await prisma().$transaction(async (tx) => {
      const data = { ...fields, name: pauseRuleName(existing) };
      // Upserted on the unique group id, so two first pauses at once do not collide.
      await tx.rule.upsert({
        where: { systemGroupId: groupId },
        update: data,
        create: {
          ...data,
          kind: RuleKind.internet,
          scope: RuleScope.group,
          mode: RuleMode.always,
          systemGroupId: groupId,
          groups: { create: { groupId } },
        },
      });
      await tx.ruleGroup.updateMany({ where: { ...lifts, pauseActive: true, pauseKind: RuleLiftKind.allow }, data: CLEARED });
    });
  } else if (action === "resume") {
    await prisma().rule.updateMany({ where: { systemGroupId: groupId, enabled: true }, data: BLOCK_CLEARED });
  } else if (action === "extend") {
    if (!block || !blocking) throw new ApiError(409, "not_paused", "Extend requires an active pause.");
    if (!block.expiresAt) throw new ApiError(409, "indefinite", "An indefinite pause has no expiry to extend.");
    await prisma().rule.update({
      where: { id: block.id },
      data: { expiresAt: extendSuspensionUntil(block.expiresAt, now, body.minutes! * 60_000) },
    });
  } else if (action === "allow") {
    const requested = until(body.until);
    // A rule already paused, or paused for this group, is not blocking it. One this group is
    // already allowed is included, so an allowance can be given a new time.
    const rules = internetLinks(existing).filter(
      ({ rule, link }) => rule.enabled && !lifted(rule, now) && !(lifted(link, now) && link.pauseKind !== RuleLiftKind.allow),
    );
    const ends = new Map(
      rules.map(({ rule }) => [rule.id, activeWindowsEnd(ruleInternetWindows(rule), now, household.timezone)] as const),
    );
    // By default each rule is lifted until its own active windows end; only those blocking now.
    const targets = rules.filter(({ rule }) => body.until !== undefined || ends.get(rule.id) !== undefined);
    if (targets.length === 0 && body.until === undefined) throw new ApiError(409, "not_in_window", "No internet rule is blocking this group now.");
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
      // Read and cleared here, so a pause that lands meanwhile is replaced, not left beside the allow.
      await tx.rule.updateMany({ where: { systemGroupId: groupId, enabled: true }, data: BLOCK_CLEARED });
    });
  } else {
    await clearAllowances();
  }

  const fresh = await prisma().group.findUniqueOrThrow({ where: { id: groupId }, include: groupInclude });
  const change = await enqueueChange(action === "disallow" ? "allow" : action);
  return { group: publicGroup(fresh, household.timezone, now), change };
}

/** A verb on one of a group's rules, for that group alone: on `internet`, the group's own pause or allowance. */
export async function liftGroupRule(
  session: Parameters<typeof liftRule>[0],
  action: LiftAction,
  target: { groupId: string; ruleId: string },
  body: LiftBody,
) {
  if (target.ruleId === INTERNET_RULE_ID) return liftGroupInternet(session, action, target.groupId, body);
  return liftRule(session, action, target, body);
}
