import { FamilyRole, GroupKind, Prisma } from "@prisma/client";
import { internetState, isWindowActive, type InternetWindow } from "@/lib/rule-windows";
import { isSuspended } from "@/lib/schedule";
import { ruleInternetWindows } from "./rules";

export type GroupAccess = "available" | "blocked" | "paused" | "allowed";

/** Everything `publicGroup` reads. */
export const groupInclude = {
  _count: { select: { devices: true } },
  rules: { include: { rule: { include: { windows: true } } } },
} satisfies Prisma.GroupInclude;

export type GroupWithRules = Prisma.GroupGetPayload<{ include: typeof groupInclude }>;

/** The group's built-in rule: an always-on block, enabled while the group is paused. */
export function blockRuleOf(group: Pick<GroupWithRules, "rules">) {
  return group.rules.map((link) => link.rule).find((rule) => rule.systemGroupId !== null);
}

/**
 * The windows of the group's enabled internet rules, in rule then window order, leaving out
 * a rule that is paused or allowed, for everyone or for this group alone.
 */
export function internetWindows(group: Pick<GroupWithRules, "rules">, now: Date): InternetWindow[] {
  return internetLinks(group)
    .filter(({ rule, link }) => rule.enabled && !lifted(rule, now) && !lifted(link, now))
    .flatMap(({ rule }) => ruleInternetWindows(rule));
}

export function lifted(state: { pauseActive: boolean; pauseUntil: Date | null }, now: Date) {
  return isSuspended({ active: state.pauseActive, until: state.pauseUntil }, now);
}

export function internetLinks(group: Pick<GroupWithRules, "rules">) {
  return group.rules
    .map((link) => ({ rule: link.rule, link }))
    .filter(({ rule }) => rule.kind === "internet" && rule.systemGroupId === null)
    .sort((a, b) => a.rule.createdAt.getTime() - b.rule.createdAt.getTime());
}

function internetRules(group: Pick<GroupWithRules, "rules">) {
  return internetLinks(group).map(({ rule }) => rule);
}

function actor(accountId: string | null, name: string | null) {
  return name ? { accountId, name } : null;
}

/** The signed-in person as a pause or allowance records them. */
export function sessionActor(session: { accountId?: string | null; username: string; account?: { displayName: string } | null }) {
  return { accountId: session.accountId ?? null, name: session.account?.displayName ?? session.username };
}

export function groupAccess(group: GroupWithRules, now: Date, timezone: string): GroupAccess {
  const state = internetState(internetGroup(group, now, timezone), internetWindows(group, now), now, timezone).state;
  if (state === "online" || state === "no_rule") return "available";
  return state;
}

/**
 * The group's pause and allowance, read from the rules that carry them. A pause is its
 * built-in block rule while enabled. An allowance is an allowance lift on any enabled
 * internet rule of the group, provided no other internet rule is blocking it now; it lasts
 * until the earliest of the lifts' ends.
 */
function internetGroup(group: GroupWithRules, now: Date, timezone: string) {
  const block = blockRuleOf(group);
  const blocking = Boolean(block?.enabled && (block.expiresAt === null || now < block.expiresAt));
  const links = internetLinks(group).filter(({ rule }) => rule.enabled);
  const allows = links.filter(({ link }) => link.pauseKind === "allow" && lifted(link, now));
  const stillBlocked = internetWindows(group, now).some((window) => isWindowActive(window, now, timezone));
  const allowed = allows.length > 0 && !stillBlocked;
  const ends = allows.map(({ link }) => link.pauseUntil).filter((end): end is Date => end !== null);
  const first = allows[0]?.link;
  return {
    suspension: {
      active: blocking,
      until: blocking ? (block!.expiresAt?.toISOString() ?? null) : null,
      by: blocking ? actor(block!.blockedByAccountId, block!.blockedByName) : null,
    },
    allowance: {
      active: allowed,
      until: allowed && ends.length ? new Date(Math.min(...ends.map((end) => end.getTime()))).toISOString() : null,
      by: allowed && first ? actor(first.pausedByAccountId, first.pausedByName) : null,
    },
  };
}

export function publicGroup(group: GroupWithRules, timezone: string, now = new Date()) {
  const internet = internetGroup(group, now, timezone);
  return {
    id: group.id,
    kind: group.kind as GroupKind,
    name: group.name,
    monogram: group.monogram,
    familyRole: group.familyRole as FamilyRole | null,
    /**
     * Null means this group reads the household resolver. A card needs it to resolve
     * its own upstream verdict rather than showing the household's.
     */
    dohOverrideUrl: group.dohOverrideUrl ?? null,
    deviceCount: group._count.devices,
    suspension: internet.suspension,
    allowance: internet.allowance,
    /** The group's internet rules. Empty means nothing limits its internet. */
    internetRuleIds: internetRules(group).map((rule) => rule.id),
    access: groupAccess(group, now, timezone),
  };
}
