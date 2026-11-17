import { AccountKind } from "@prisma/client";
import type { Rule } from "@/lib/rules";
import type { Actor, Group } from "@/lib/types";
import { prisma } from "./db";

/*
 * What a child's phone (FamilyFi Me) reads of its own group, through the routes every client uses:
 * `GET /groups/{id}` and `GET /rules`. It builds its day from them with `groupDayOf`
 * (src/lib/child-day.ts). These trim the answers to that group and its people: no account id, no
 * resolver address, and no name for the recovery account, which is no person, so FamilyFi Me
 * tells the pause without a name.
 */

async function recoveryAccountIds(): Promise<Set<string>> {
  const accounts = await prisma().account.findMany({ where: { kind: AccountKind.recovery }, select: { id: true } });
  return new Set(accounts.map((account) => account.id));
}

function unnamed(recovery: Set<string>) {
  return (by: Actor): Actor => (!by || (by.accountId && recovery.has(by.accountId)) ? null : { accountId: null, name: by.name });
}

/** The group as a child's phone reads it. */
export async function groupForChild(group: Group): Promise<Group> {
  const actor = unnamed(await recoveryAccountIds());
  return { ...group, dohOverrideUrl: null, suspension: { ...group.suspension, by: actor(group.suspension.by) }, allowance: { ...group.allowance, by: actor(group.allowance.by) } };
}

/**
 * The rules a child's phone reads: the household's own rules that cover its group (never a
 * built-in protection), each showing that group alone among those it covers and lifts.
 */
export async function rulesForChild(rules: Rule[], groupId: string): Promise<Rule[]> {
  const actor = unnamed(await recoveryAccountIds());
  return rules
    .filter((rule) => rule.builtIn === null && (rule.groupIds ?? []).includes(groupId))
    .map((rule) => ({
      ...rule,
      groupIds: [groupId],
      pause: { ...rule.pause, by: actor(rule.pause.by) },
      groupPauses: (rule.groupPauses ?? []).filter((item) => item.groupId === groupId).map((item) => ({ ...item, pause: { ...item.pause, by: actor(item.pause.by) } })),
    }));
}
