import { AccountKind, GroupKind } from "@prisma/client";
import type { Rule } from "@/lib/rules";
import type { Actor, Group } from "@/lib/types";
import { prisma } from "./db";
import { ApiError } from "./http";

/*
 * What a child's phone (FamilyFi Me) reads, through the routes every client uses: `GET /groups`,
 * `GET /groups/{id}` and `GET /rules`. It reads its own group and the Things groups a parent shares
 * with children (`kidsCanAsk`), and builds each one's day with `groupDayOf` (src/lib/child-day.ts).
 * These trim the answers to those groups, and name no one for the recovery account, which is no
 * person, so FamilyFi Me tells the pause without a name.
 */

async function recoveryAccountIds(): Promise<Set<string>> {
  const accounts = await prisma().account.findMany({ where: { kind: AccountKind.recovery }, select: { id: true } });
  return new Set(accounts.map((account) => account.id));
}

function unnamed(recovery: Set<string>) {
  return (by: Actor): Actor => (by?.accountId && recovery.has(by.accountId) ? null : by);
}

/** The Things groups a parent shares with children, oldest first. */
export async function sharedThingIds(): Promise<string[]> {
  const things = await prisma().group.findMany({ where: { kind: GroupKind.things, kidsCanAsk: true }, select: { id: true }, orderBy: { createdAt: "asc" } });
  return things.map((thing) => thing.id);
}

/** Every group a child's phone reads: its own first, then the shared Things. */
export async function childGroupIds(ownGroupId: string): Promise<string[]> {
  return [ownGroupId, ...(await sharedThingIds())];
}

/** Refuses a group a child's phone does not read, as if it were not there. */
export async function requireChildReads(ownGroupId: string, groupId: string): Promise<void> {
  if (!(await childGroupIds(ownGroupId)).includes(groupId)) throw new ApiError(404, "not_found", "Group not found.");
}

/**
 * A group as a child's phone reads it. On a shared Thing the child sees only its own latest ask,
 * so another child's ask is never told as theirs.
 */
export async function groupForChild(group: Group, ownGroupId: string = group.id): Promise<Group> {
  const actor = unnamed(await recoveryAccountIds());
  const { ask, ...rest } = group;
  const own = ask && (group.id === ownGroupId || ask.from?.groupId === ownGroupId) ? ask : undefined;
  return {
    ...rest,
    suspension: { ...group.suspension, by: actor(group.suspension.by) },
    allowance: { ...group.allowance, by: actor(group.allowance.by) },
    ...(own ? { ask: { ...own, ...(own.by !== undefined ? { by: actor(own.by) } : {}) } } : {}),
  };
}

/**
 * The rules a child's phone reads: the household's own rules that cover one of the groups it reads
 * (never a built-in protection), each showing only those groups among those it covers and lifts.
 */
export async function rulesForChild(rules: Rule[], groupIds: string[]): Promise<Rule[]> {
  const actor = unnamed(await recoveryAccountIds());
  const reads = new Set(groupIds);
  return rules
    .filter((rule) => rule.builtIn === null && (rule.groupIds ?? []).some((id) => reads.has(id)))
    .map((rule) => ({
      ...rule,
      groupIds: (rule.groupIds ?? []).filter((id) => reads.has(id)),
      pause: { ...rule.pause, by: actor(rule.pause.by) },
      groupPauses: (rule.groupPauses ?? []).filter((item) => reads.has(item.groupId)).map((item) => ({ ...item, pause: { ...item.pause, by: actor(item.pause.by) } })),
    }));
}
