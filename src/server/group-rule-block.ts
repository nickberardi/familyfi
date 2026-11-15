import { RuleMode, RuleScope } from "@prisma/client";
import { extendSuspensionUntil } from "@/lib/schedule";
import { enqueueChange } from "./changes";
import { prisma } from "./db";
import { BLOCK_CLEARED } from "./group-internet";
import { blockButtonCandidate, blockRuleOf, groupInclude, publicGroup, sessionActor } from "./groups";
import { jsonError } from "./http";
import { readLiftBody } from "./rule-lifts";
import { ruleBlockName } from "./unifi/names";

export type RuleBlockAction = "block" | "end" | "extend";

/**
 * Blocks one of the group's own category, app or website rules for the group now, whatever its
 * schedule says: what its Block button does when that rule is its Block button default. It is the
 * group's own block, the same built-in always-on rule as a pause, blocking that rule's categories,
 * apps or websites instead of all internet, until `until` or until ended; a pause and a block
 * replace each other. `end` and `extend` act on it only while it blocks this rule. The rule itself
 * is untouched, and it blocks even while the rule is off or paused. Returns `{ group, change }`.
 */
export async function runGroupRuleBlock(
  request: Request,
  session: Parameters<typeof sessionActor>[0],
  action: RuleBlockAction,
  groupId: string,
  ruleId: string,
): Promise<Response> {
  const read = await readLiftBody(request, action === "block" ? "pause" : action === "extend" ? "extend" : "resume");
  if (!read.ok) return read.response;
  const body = read.body as { until?: string | null; minutes?: number };

  const existing = await prisma().group.findUnique({ where: { id: groupId }, include: groupInclude });
  if (!existing) return jsonError(404, "not_found", "Group not found.");
  const link = existing.rules.find((item) => item.rule.id === ruleId && blockButtonCandidate(item.rule));
  if (!link) return jsonError(404, "not_found", "That group does not have this category, app or website rule.");
  const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
  const now = new Date();
  const block = blockRuleOf(existing);
  const blocking = Boolean(block?.enabled && block.blocksRuleId === ruleId && (block.expiresAt === null || now < block.expiresAt));
  const thisBlock = { systemGroupId: groupId, enabled: true, blocksRuleId: ruleId };

  if (action === "block") {
    const end = body.until ? new Date(body.until) : null;
    if (end && end.getTime() <= now.getTime()) return jsonError(400, "invalid_request", "until must be in the future.");
    const actor = sessionActor(session);
    const data = {
      enabled: true,
      expiresAt: end,
      blockedByAccountId: actor.accountId,
      blockedByName: actor.name,
      name: ruleBlockName(existing, link.rule.name),
      kind: link.rule.kind,
      targetIds: link.rule.targetIds,
      domains: link.rule.domains,
      blocksRuleId: ruleId,
    };
    // Upserted on the unique group id, as a pause is, so two first blocks at once do not collide.
    await prisma().rule.upsert({
      where: { systemGroupId: groupId },
      update: data,
      create: { ...data, scope: RuleScope.group, mode: RuleMode.always, systemGroupId: groupId, groups: { create: { groupId } } },
    });
  } else if (action === "end") {
    await prisma().rule.updateMany({ where: thisBlock, data: BLOCK_CLEARED });
  } else {
    if (!block || !blocking) return jsonError(409, "not_blocked", "Extend requires this rule's block to be on.");
    if (!block.expiresAt) return jsonError(409, "indefinite", "A block until you unblock has no expiry to extend.");
    await prisma().rule.update({ where: { id: block.id }, data: { expiresAt: extendSuspensionUntil(block.expiresAt, now, body.minutes! * 60_000) } });
  }

  const fresh = await prisma().group.findUniqueOrThrow({ where: { id: groupId }, include: groupInclude });
  const change = await enqueueChange(action === "block" ? "pause" : action === "end" ? "resume" : "extend");
  return Response.json({ group: publicGroup(fresh, household.timezone, now), change });
}
