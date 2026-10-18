import { RuleLiftKind } from "@prisma/client";
import { extendSuspensionUntil } from "@/lib/schedule";
import { enqueueChange } from "./changes";
import { prisma } from "./db";
import { blockRuleOf, groupInclude, lifted, publicGroup, sessionActor } from "./groups";
import { jsonError } from "./http";
import { CLEARED, readLiftBody } from "./rule-lifts";
import { activeWindowsEnd, presentRules, ruleInclude, ruleInternetWindows } from "./rules";

export type UnblockAction = "unblock" | "end" | "extend";

const BLOCK_CLEARED = { enabled: false, expiresAt: null, blockedByAccountId: null, blockedByName: null };

/**
 * Unblocks a group: whatever blocks it now stops, for this group alone, whichever kind of rule
 * it is. The group's own pause ends, and each rule blocking it now is allowed for the group until
 * its active windows end, or every rule it has until `until`. An allowance, one per rule, so its
 * devices leave the rule's policies and the rule itself is untouched. `end` and `extend` act on
 * those allowances together: `extend` gives each timed one the same new end, the latest plus `minutes`. Returns `{ group, rules, change }`, `rules` being the group's own.
 */
export async function runGroupUnblock(
  request: Request,
  session: Parameters<typeof sessionActor>[0],
  action: UnblockAction,
  groupId: string,
): Promise<Response> {
  const read = await readLiftBody(request, action === "unblock" ? "allow" : action === "extend" ? "extend" : "resume");
  if (!read.ok) return read.response;
  const body = read.body as { until?: string | null; minutes?: number };

  const existing = await prisma().group.findUnique({ where: { id: groupId }, include: groupInclude });
  if (!existing) return jsonError(404, "not_found", "Group not found.");
  const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
  const now = new Date();
  const links = existing.rules.filter(({ rule }) => rule.systemGroupId === null);
  const allowances = links.filter((link) => link.pauseKind === RuleLiftKind.allow && lifted(link, now));

  if (action === "unblock") {
    const requested = body.until ? new Date(body.until) : null;
    if (requested && requested.getTime() <= now.getTime()) return jsonError(400, "invalid_request", "until must be in the future.");
    const block = blockRuleOf(existing);
    const blockedByPause = Boolean(block?.enabled && (block.expiresAt === null || now < block.expiresAt));
    // A rule paused for everyone, or paused for this group, is not blocking it. One this group is
    // already allowed is included, so an unblock can be given a new time.
    const candidates = links.filter(
      ({ rule, ...link }) => rule.enabled && !lifted(rule, now) && !(lifted(link, now) && link.pauseKind !== RuleLiftKind.allow),
    );
    const ends = new Map(candidates.map(({ rule }) => [rule.id, activeWindowsEnd(ruleInternetWindows(rule), now, household.timezone)] as const));
    // By default only the rules blocking now, each until its own windows end; given a time, every rule.
    const targets = candidates.filter(({ rule }) => body.until !== undefined || ends.get(rule.id) !== undefined);
    if (targets.length === 0 && !blockedByPause) return jsonError(409, "not_blocked", "Nothing is blocking this group now.");
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
  } else if (action === "end") {
    await prisma().ruleGroup.updateMany({
      where: { groupId, rule: { systemGroupId: null }, pauseActive: true, pauseKind: RuleLiftKind.allow },
      data: CLEARED,
    });
  } else {
    if (allowances.length === 0) return jsonError(409, "not_unblocked", "Extend requires an active unblock.");
    const timed = allowances.filter((link) => link.pauseUntil !== null);
    if (timed.length === 0) return jsonError(409, "indefinite", "An unblock with no end time has no expiry to extend.");
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
  return Response.json({ group: publicGroup(fresh, household.timezone, now), rules: await presentRules(rules), change });
}
