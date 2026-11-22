import { AskState, AssignmentState, FamilyRole, GroupKind, Prisma, RuleLiftKind, type Ask } from "@prisma/client";
import { mapLimited } from "@/lib/concurrency";
import { internetState, isWindowActive, type InternetWindow } from "@/lib/rule-windows";
import { COUNTRIES_RULE_ID, LOCK_DNS_RULE_ID } from "@/lib/rules";
import { isSuspended } from "@/lib/schedule";
import { enqueueChange } from "./changes";
import { prisma } from "./db";
import { loadHousehold } from "./household";
import { ApiError } from "./http";
import { revokeGroupDevices } from "./connection";
import { builtInRule, joinCountriesRule, lockHousehold, ruleInternetWindows } from "./rules";
import { clientForHousehold, connectionIdentity } from "./unifi/connection";
import { GATEWAY_CONCURRENCY } from "./unifi/networks";
import { currentHouseholdId } from "./household-context";

export type GroupAccess = "available" | "blocked" | "paused" | "allowed";

/** Everything `publicGroup` reads. */
export const groupInclude = {
  _count: { select: { devices: true } },
  rules: { include: { rule: { include: { windows: true } } } },
  asks: { orderBy: { createdAt: "desc" }, take: 1, include: { fromGroup: { select: { name: true } } } },
} satisfies Prisma.GroupInclude;

export type GroupWithRules = Prisma.GroupGetPayload<{ include: typeof groupInclude }>;

/** The group's built-in rule: an always-on block, enabled while the group is paused. */
export function blockRuleOf(group: Pick<GroupWithRules, "rules">) {
  return group.rules.map((link) => link.rule).find((rule) => rule.systemGroupId !== null);
}

type BlockRule = NonNullable<ReturnType<typeof blockRuleOf>>;

/**
 * The group's pause now: `set` while its block rule is on and not past its end; `onBreak` while a
 * parent's timed yes to a child's ask lifts it (the block rule paused until `pauseUntil`, which the
 * gateway sees as its policy disabled), after which it blocks again until its own end; `blocking`
 * when set and not on a break.
 */
export function pauseOf(block: BlockRule | undefined, now: Date) {
  const set = Boolean(block?.enabled && (block.expiresAt === null || now < block.expiresAt));
  const onBreak = set && lifted(block!, now);
  return { set, onBreak, blocking: set && !onBreak };
}

/** What ends a pause's break, with the pause or to put the pause back at once. */
export const BREAK_CLEARED = { pauseActive: false, pauseUntil: null, pausedByAccountId: null, pausedByName: null };

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
  const { blocking, onBreak } = pauseOf(block, now);
  const links = internetLinks(group).filter(({ rule }) => rule.enabled);
  const allows = links.filter(({ link }) => link.pauseKind === "allow" && lifted(link, now));
  const stillBlocked = internetWindows(group, now).some((window) => isWindowActive(window, now, timezone));
  const allowed = allows.length > 0 && !stillBlocked;
  const ends = allows.map(({ link }) => link.pauseUntil).filter((end): end is Date => end !== null);
  const first = allows[0]?.link;
  // A pause on a break reads as not paused, with when it blocks again, and as allowed until then:
  // a client that does not know the break still tells the time open truly.
  if (onBreak) {
    return {
      suspension: {
        active: false,
        until: block!.expiresAt?.toISOString() ?? null,
        by: actor(block!.blockedByAccountId, block!.blockedByName),
        resumesAt: block!.pauseUntil!.toISOString(),
      },
      allowance: { active: true, until: block!.pauseUntil!.toISOString(), by: actor(block!.pausedByAccountId, block!.pausedByName) },
    };
  }
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

/**
 * The rule the group's Block button blocks and unblocks: its Block button default while that is
 * still one of its own category, app or website rules. Undefined: all internet.
 */
export function blockButtonRuleOf(group: Pick<GroupWithRules, "rules" | "blockButtonRuleId">) {
  if (!group.blockButtonRuleId) return undefined;
  return group.rules
    .map((link) => link.rule)
    .find((rule) => rule.id === group.blockButtonRuleId && blockButtonCandidate(rule));
}

/** A rule a group's Block button can stand for: a category, app or website rule of its own, not built in. */
export function blockButtonCandidate(rule: Pick<GroupWithRules["rules"][number]["rule"], "id" | "kind" | "systemGroupId">): boolean {
  return rule.kind !== "internet" && rule.systemGroupId === null && builtInRule(rule) === null;
}

/** How long a group shows its latest ask for more time. */
export const ASK_SHOWN_MS = 24 * 60 * 60_000;

/**
 * An ask as the API shows it. One left waiting past `expiresAt` reads as closed, before the next
 * sync pass's sweep writes it: `ended` when that was the block's end, else `timedOut`.
 */
export function presentAsk(ask: Ask & { fromGroup?: { name: string } | null }, now: Date) {
  const lapsed = ask.state === AskState.waiting && ask.expiresAt <= now;
  const state = lapsed ? (ask.endsWithBlock ? AskState.ended : AskState.timedOut) : ask.state;
  const answered = state === AskState.yes || state === AskState.no;
  return {
    id: ask.id,
    about: ask.about as "pause" | "rule",
    // On a shared Thing: the child who asked. Left out on a child's own group, which asked itself.
    ...(ask.fromGroupId !== ask.groupId && ask.fromGroup ? { from: { groupId: ask.fromGroupId, name: ask.fromGroup.name } } : {}),
    ...(ask.ruleId ? { ruleId: ask.ruleId } : {}),
    ...(ask.minutes !== null ? { minutes: ask.minutes } : {}),
    state,
    at: ask.createdAt.toISOString(),
    ...(state === AskState.waiting ? { expiresAt: ask.expiresAt.toISOString() } : {}),
    ...(answered && ask.answeredAt ? { answeredAt: ask.answeredAt.toISOString(), by: actor(ask.answeredByAccountId, ask.answeredByName) } : {}),
    ...(state === AskState.no && ask.askAgainAt ? { askAgainAt: ask.askAgainAt.toISOString() } : {}),
  };
}

export function publicGroup(group: GroupWithRules, timezone: string, now = new Date()) {
  const internet = internetGroup(group, now, timezone);
  const blockButton = blockButtonRuleOf(group);
  const latestAsk = group.asks.find((ask) => now.getTime() - ask.createdAt.getTime() < ASK_SHOWN_MS);
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
    /** The rule the group's Block button blocks and unblocks; absent for all internet. */
    ...(blockButton ? { blockButtonRuleId: blockButton.id } : {}),
    /** A Things group only: whether children with FamilyFi Me see it and ask for more time on it. */
    ...(group.kind === GroupKind.things ? { kidsCanAsk: group.kidsCanAsk } : {}),
    ...(latestAsk ? { ask: presentAsk(latestAsk, now) } : {}),
  };
}

function groupNotFound() {
  return new ApiError(404, "not_found", "Group not found.");
}

export async function listGroups() {
  const household = await loadHousehold();
  const groups = await prisma().group.findMany({ include: groupInclude, orderBy: { createdAt: "asc" } });
  return groups.map((group) => publicGroup(group, household.timezone));
}

export async function getGroup(id: string) {
  const household = await loadHousehold();
  const group = await prisma().group.findUnique({ where: { id }, include: groupInclude });
  if (!group) throw groupNotFound();
  return publicGroup(group, household.timezone);
}

export async function createGroup(input: { kind: GroupKind; name: string; monogram?: string; familyRole?: FamilyRole }) {
  const household = await loadHousehold();
  const created = await prisma().$transaction(async (tx) => {
    // Serialized with other group creates and Block countries saves, so "covers every group" holds.
    await lockHousehold(tx);
    const group = await tx.group.create({ data: { kind: input.kind, name: input.name, monogram: input.monogram, familyRole: input.familyRole } });
    await joinCountriesRule(tx, group.id);
    return group;
  });
  const group = await prisma().group.findUniqueOrThrow({ where: { id: created.id }, include: groupInclude });
  const change = await enqueueChange("group");
  return { group: publicGroup(group, household.timezone), change };
}

/**
 * A field left out stays as it is; `blockButtonRuleId` null puts the Block button back on all
 * internet. `kidsCanAsk` is for a Things group only.
 */
export async function updateGroup(
  id: string,
  input: { name?: string; monogram?: string | null; familyRole?: FamilyRole | null; blockButtonRuleId?: string | null; kidsCanAsk?: boolean },
) {
  const existing = await prisma().group.findUnique({ where: { id }, include: groupInclude });
  if (!existing) throw groupNotFound();
  if (input.kidsCanAsk !== undefined && existing.kind !== GroupKind.things) {
    throw new ApiError(400, "invalid_request", "Only a Things group can be shared with kids.");
  }
  const { blockButtonRuleId } = input;
  if (blockButtonRuleId && !existing.rules.some((link) => link.rule.id === blockButtonRuleId && blockButtonCandidate(link.rule))) {
    throw new ApiError(400, "invalid_block_button_rule", "The Block button can stand for one of this group's own category, app or website rules.");
  }
  const household = await loadHousehold();
  const group = await prisma().group.update({
    where: { id },
    data: { name: input.name, monogram: input.monogram, familyRole: input.familyRole, blockButtonRuleId, kidsCanAsk: input.kidsCanAsk },
    include: groupInclude,
  });
  const change = await enqueueChange("group");
  return { group: publicGroup(group, household.timezone), change };
}

/**
 * Deletes a group: its devices go to quarantine, and a rule that covered only this group goes with
 * it, its gateway policies deleted here rather than left to the next sync pass.
 */
export async function deleteGroup(id: string) {
  const existing = await prisma().group.findUnique({ where: { id } });
  if (!existing) throw groupNotFound();
  await prisma().device.updateMany({
    where: { groupId: id },
    data: { groupId: null, assignment: AssignmentState.quarantined },
  });
  // A rule that covered only this group goes with it. Delete its recorded UniFi
  // policies before the Rule rows cascade (D3). Rules shared with other groups stay, and
  // so do Lock DNS and Block countries: they are built in, and only lose the group.
  const rules = await prisma().rule.findMany({
    where: { scope: "group", id: { notIn: [LOCK_DNS_RULE_ID, COUNTRIES_RULE_ID] }, groups: { some: { groupId: id }, every: { groupId: id } } },
    include: { policies: true },
  });
  const household = await prisma().household.findUnique({ where: { id: currentHouseholdId() } });
  if (household && household.connectionStatus !== "unconfigured" && household.unifiSiteId) {
    try {
      const client = clientForHousehold(household);
      const identity = connectionIdentity(household);
      const siteId = household.unifiSiteId;
      const ids = rules
        .flatMap((rule) => rule.policies)
        .filter((policy) => policy.connectionIdentity === identity && policy.siteId === siteId && policy.unifiPolicyId)
        .map((policy) => policy.unifiPolicyId!);
      // A few at a time, so a group with many rule windows does not hold the request for each in turn.
      await mapLimited(ids, GATEWAY_CONCURRENCY, async (unifiPolicyId) => {
        try {
          await client.deletePolicy(siteId, unifiPolicyId);
        } catch {
          // Its applied creation record outlives the rule, so the next pass's orphan sweep deletes it.
        }
      });
    } catch {
      // Proceed with desired-state delete.
    }
  }
  await prisma().rulePolicy.deleteMany({ where: { ruleId: { in: rules.map((r) => r.id) } } });
  await prisma().rule.deleteMany({ where: { id: { in: rules.map((r) => r.id) } } });
  await prisma().$transaction(async (db) => {
    // A child's phone signs in for this group alone, so it is signed out with it. Revoked, not
    // deleted, so its record and history stay; the group link then clears. The row is locked first: a
    // claim in flight holds it FOR SHARE, so the revoke waits for its device; a later claim finds no group.
    await db.$queryRaw`SELECT "id" FROM "Group" WHERE "id" = ${id} FOR UPDATE`;
    await revokeGroupDevices(id, db as never);
    await db.group.delete({ where: { id } });
  });
  // Block countries on with no group means every group, so it keeps going when the last group goes. While other
  // groups are left it can't cover none of them, so it turns off, as it does when it loses its last network.
  if (await prisma().group.count()) {
    await prisma().rule.updateMany({
      where: { id: COUNTRIES_RULE_ID, scope: "group", groups: { none: {} } },
      data: { enabled: false, pauseActive: false, pauseUntil: null, pauseKind: RuleLiftKind.pause, pausedByAccountId: null, pausedByName: null },
    });
  }
  return { change: await enqueueChange("group") };
}
