import { AssignmentState, FamilyRole, GroupKind, Prisma, RuleLiftKind } from "@prisma/client";
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

export function publicGroup(group: GroupWithRules, timezone: string, now = new Date()) {
  const internet = internetGroup(group, now, timezone);
  const blockButton = blockButtonRuleOf(group);
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

/** A field left out stays as it is; `blockButtonRuleId` null puts the Block button back on all internet. */
export async function updateGroup(
  id: string,
  input: { name?: string; monogram?: string | null; familyRole?: FamilyRole | null; blockButtonRuleId?: string | null },
) {
  const existing = await prisma().group.findUnique({ where: { id }, include: groupInclude });
  if (!existing) throw groupNotFound();
  const { blockButtonRuleId } = input;
  if (blockButtonRuleId && !existing.rules.some((link) => link.rule.id === blockButtonRuleId && blockButtonCandidate(link.rule))) {
    throw new ApiError(400, "invalid_block_button_rule", "The Block button can stand for one of this group's own category, app or website rules.");
  }
  const household = await loadHousehold();
  const group = await prisma().group.update({
    where: { id },
    data: { name: input.name, monogram: input.monogram, familyRole: input.familyRole, blockButtonRuleId },
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
  const household = await prisma().household.findUnique({ where: { id: "default" } });
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
    // deleted, so its record and history stay; the group link then clears.
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
