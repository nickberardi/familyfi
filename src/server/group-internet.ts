import { RuleKind, RuleLiftKind, RuleMode, RuleScope } from "@prisma/client";
import { extendSuspensionUntil } from "@/lib/schedule";
import { enqueueChange } from "./changes";
import { prisma } from "./db";
import { blockRuleOf, groupInclude, internetLinks, lifted, publicGroup, sessionActor } from "./groups";
import { jsonError } from "./http";
import { CLEARED, readLiftBody, type LiftAction } from "./rule-lifts";
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
 * other. Returns `{ group, change }`.
 */
export async function runGroupInternet(
  request: Request,
  session: Parameters<typeof sessionActor>[0],
  action: LiftAction,
  groupId: string,
): Promise<Response> {
  const read = await readLiftBody(request, action);
  if (!read.ok) return read.response;
  const body = read.body as { until?: string | null; minutes?: number };

  const existing = await prisma().group.findUnique({ where: { id: groupId }, include: groupInclude });
  if (!existing) return jsonError(404, "not_found", "Group not found.");
  const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
  const now = new Date();
  const actor = sessionActor(session);
  const block = blockRuleOf(existing);
  const blocking = Boolean(block?.enabled && (block.expiresAt === null || now < block.expiresAt));
  const lifts = { groupId, rule: { kind: RuleKind.internet, systemGroupId: null } };
  const clearAllowances = () =>
    prisma().ruleGroup.updateMany({ where: { ...lifts, pauseActive: true, pauseKind: RuleLiftKind.allow }, data: CLEARED });

  const until = (requested: string | null | undefined): Date | null | Response => {
    const value = requested ? new Date(requested) : null;
    return value && value.getTime() <= now.getTime() ? jsonError(400, "invalid_request", "until must be in the future.") : value;
  };

  if (action === "pause") {
    const end = until(body.until);
    if (end instanceof Response) return end;
    const fields = { enabled: true, expiresAt: end, blockedByAccountId: actor.accountId, blockedByName: actor.name };
    await prisma().$transaction(async (tx) => {
      const data = { ...fields, name: pauseRuleName(existing) };
      if (block) await tx.rule.update({ where: { id: block.id }, data });
      else {
        await tx.rule.create({
          data: {
            ...data,
            kind: RuleKind.internet,
            scope: RuleScope.group,
            mode: RuleMode.always,
            systemGroupId: groupId,
            groups: { create: { groupId } },
          },
        });
      }
      await tx.ruleGroup.updateMany({ where: { ...lifts, pauseActive: true, pauseKind: RuleLiftKind.allow }, data: CLEARED });
    });
  } else if (action === "resume") {
    if (block && blocking) await prisma().rule.update({ where: { id: block.id }, data: BLOCK_CLEARED });
  } else if (action === "extend") {
    if (!block || !blocking) return jsonError(409, "not_paused", "Extend requires an active pause.");
    if (!block.expiresAt) return jsonError(409, "indefinite", "An indefinite pause has no expiry to extend.");
    await prisma().rule.update({
      where: { id: block.id },
      data: { expiresAt: extendSuspensionUntil(block.expiresAt, now, body.minutes! * 60_000) },
    });
  } else if (action === "allow") {
    const requested = until(body.until);
    if (requested instanceof Response) return requested;
    // A rule already paused, or lifted for this group, is not blocking it.
    const rules = internetLinks(existing).filter(({ rule, link }) => rule.enabled && !lifted(rule, now) && !lifted(link, now));
    const ends = new Map(
      rules.map(({ rule }) => [rule.id, activeWindowsEnd(ruleInternetWindows(rule), now, household.timezone)] as const),
    );
    // By default each rule is lifted until its own active windows end; only those blocking now.
    const targets = rules.filter(({ rule }) => body.until !== undefined || ends.get(rule.id) !== undefined);
    if (targets.length === 0 && body.until === undefined) return jsonError(409, "not_in_window", "No internet rule is blocking this group now.");
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
      if (block && blocking) await tx.rule.update({ where: { id: block.id }, data: BLOCK_CLEARED });
    });
  } else {
    await clearAllowances();
  }

  const fresh = await prisma().group.findUniqueOrThrow({ where: { id: groupId }, include: groupInclude });
  const change = await enqueueChange(action === "disallow" ? "allow" : action);
  return Response.json({ group: publicGroup(fresh, household.timezone, now), change });
}
