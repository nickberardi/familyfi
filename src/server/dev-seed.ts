import { AccountKind, AssignmentState, FamilyRole, GroupKind, RuleKind, RuleLiftKind, RuleMode, UpstreamVerdict } from "@prisma/client";
import { hashPassword } from "./auth";
import { encryptSecret } from "./crypto";
import {
  DEV_ADMIN,
  DEV_DEVICES,
  DEV_DOH_URL,
  DEV_GROUPS,
  DEV_LIVE_STATES,
  DEV_RULES,
  DEV_UPSTREAM_VERDICTS,
  devDeviceIp,
  type DevNetwork,
  type DevVerdict,
} from "./dev-household";
import { prisma } from "./db";
import { recoveryPassword, unifiMockEnabled } from "./env";
import { pauseRuleName } from "./unifi/names";
import { refreshResolverContexts } from "./upstream/discovery";
import {
  DEV_MOCK_API_KEY,
  DEV_MOCK_BASE_URL,
  DEV_MOCK_INTERNAL_NETWORK,
  DEV_MOCK_INTERNAL_ZONE,
  DEV_MOCK_IOT_NETWORK,
  DEV_MOCK_IOT_ZONE,
  DEV_MOCK_SITE_ID,
} from "./unifi/dev-mock";

export const DEV_SEED_ADULT_USERNAME = DEV_ADMIN.username;

async function ensureMockUnifiConnection() {
  const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
  if (household.unifiKeyLastFour) return;
  const secret = encryptSecret(DEV_MOCK_API_KEY);
  await prisma().household.update({
    where: { id: "default" },
    data: {
      unifiMode: "local",
      unifiBaseUrl: DEV_MOCK_BASE_URL,
      unifiConsoleId: null,
      unifiSiteId: DEV_MOCK_SITE_ID,
      unifiTlsInsecure: true,
      unifiManageAllNetworks: true,
      unifiManagedNetworkIds: [],
      unifiKeyCiphertext: Uint8Array.from(secret.ciphertext),
      unifiKeyIv: Uint8Array.from(secret.iv),
      unifiKeyAuthTag: Uint8Array.from(secret.authTag),
      unifiKeyLastFour: DEV_MOCK_API_KEY.slice(-4),
      connectionStatus: "connected",
      connectionError: null,
      // Category reports go through this resolver, but the probe never runs: the mock's
      // verdicts are seeded, and a sweep would replace them with real ones.
      dohUrl: DEV_DOH_URL,
      dohProbeEnabled: false,
    },
  });
}

const NETWORKS: Record<DevNetwork, { networkId: string; zoneId: string }> = {
  lan: { networkId: DEV_MOCK_INTERNAL_NETWORK, zoneId: DEV_MOCK_INTERNAL_ZONE },
  iot: { networkId: DEV_MOCK_IOT_NETWORK, zoneId: DEV_MOCK_IOT_ZONE },
};

/** Writes the household in `dev-household.ts`, once: a database with any person in it is left alone. */
async function ensureDummyHouseholdMembers() {
  const existing = await prisma().group.count({ where: { kind: GroupKind.family } });
  if (existing > 0) return;

  const groupIds = new Map<string, string>();
  for (const group of DEV_GROUPS) {
    const created = await prisma().group.create({
      data:
        group.kind === "family"
          ? { kind: GroupKind.family, name: group.name, familyRole: FamilyRole[group.familyRole] }
          : { kind: GroupKind.things, name: group.name, monogram: group.monogram },
    });
    groupIds.set(group.name, created.id);
  }
  const idOf = (name: string) => groupIds.get(name)!;

  const admin = await prisma().account.create({
    data: {
      username: DEV_ADMIN.username,
      displayName: DEV_ADMIN.displayName,
      kind: AccountKind.personal,
      isAdmin: true,
      groupId: idOf(DEV_ADMIN.group),
      passwordHash: await hashPassword(recoveryPassword()),
    },
  });

  const ruleIds = new Map<string, string>();
  for (const rule of DEV_RULES) {
    const created = await prisma().rule.create({
      data: {
        name: rule.name,
        kind: RuleKind[rule.kind],
        targetIds: rule.targetIds ?? [],
        domains: rule.domains ?? [],
        mode: rule.windows ? RuleMode.scheduled : RuleMode.always,
        groups: { create: rule.groups.map((name) => ({ groupId: idOf(name) })) },
        windows: { create: (rule.windows ?? []).map((window, position) => ({ ...window, position })) },
      },
    });
    ruleIds.set(rule.name, created.id);
  }

  const now = Date.now();
  const { pausedGroup, allowance, pausedRule, by } = DEV_LIVE_STATES;
  const actor = { pausedByAccountId: admin.id, pausedByName: by };
  // A group's pause is the built-in rule its own pause uses.
  await prisma().rule.create({
    data: {
      name: pauseRuleName({ name: pausedGroup.group, kind: GroupKind.family }),
      kind: RuleKind.internet,
      mode: RuleMode.always,
      systemGroupId: idOf(pausedGroup.group),
      expiresAt: new Date(now + pausedGroup.forMs),
      blockedByAccountId: admin.id,
      blockedByName: by,
      groups: { create: { groupId: idOf(pausedGroup.group) } },
    },
  });
  // An allowance lifts the group's internet rule for it alone.
  await prisma().ruleGroup.update({
    where: { ruleId_groupId: { ruleId: ruleIds.get(allowance.rule)!, groupId: idOf(allowance.group) } },
    data: { pauseActive: true, pauseUntil: new Date(now + allowance.forMs), pauseKind: RuleLiftKind.allow, ...actor },
  });
  // A rule pause lifts it for every group it covers.
  await prisma().rule.update({
    where: { id: ruleIds.get(pausedRule.rule)! },
    data: { pauseActive: true, pauseUntil: new Date(now + pausedRule.forMs), pauseKind: RuleLiftKind.pause, ...actor },
  });

  await prisma().device.createMany({
    data: DEV_DEVICES.map((item) => ({
      mac: item.mac,
      hostname: item.name,
      ip: devDeviceIp(item),
      ...NETWORKS[item.network],
      groupId: item.group ? idOf(item.group) : null,
      assignment: item.group ? AssignmentState.assigned : AssignmentState.quarantined,
    })),
  });
}

const VERDICTS: Record<DevVerdict["verdict"], UpstreamVerdict> = {
  blocked: UpstreamVerdict.blocked,
  partial: UpstreamVerdict.partial,
  open: UpstreamVerdict.open,
};

/**
 * Writes measured checks for `verdicts` at each scope: the household (`null`) and groups.
 * Each carries real per-domain results, not an empty array — otherwise every domain row on
 * the category detail screen reads "Not checked" whatever the category's mark says, which
 * is the exact mismatch the mock exists to catch.
 */
async function writeUpstreamChecks(verdicts: readonly DevVerdict[], scopes: (string | null)[]) {
  const contexts = await refreshResolverContexts();
  for (const item of verdicts) {
    const category = await prisma().upstreamCategory.findUnique({ where: { slug: item.slug }, select: { id: true } });
    if (!category) continue;
    const domains = await prisma().upstreamDomain.findMany({
      where: { categoryId: category.id, removedAt: null },
      select: { domain: true },
      orderBy: { domain: "asc" },
    });
    const blockedCount = item.verdict === "blocked" ? domains.length : item.verdict === "open" ? 0 : Math.min(item.blockedCount ?? 1, domains.length - 1);
    const results = domains.map(({ domain }, index) => ({
      domain,
      blocked: index < blockedCount,
      rcode: index < blockedCount ? 3 : 0,
    }));
    for (const groupId of scopes) {
      const context = groupId === null ? contexts.household : contexts.groups.get(groupId);
      if (!context || context.source === "unknown") continue;
      await prisma().upstreamCheck.createMany({ data: [{
        categoryId: category.id, groupId, verdict: VERDICTS[item.verdict],
        blockedCount, totalCount: domains.length,
        results, durationMs: 120, resolverContext: context,
        networkResults: context.networks.map((network) => ({
          id: network.id, name: network.name, verdict: VERDICTS[item.verdict], error: null,
          servers: network.servers.map((address) => ({ address, verdict: VERDICTS[item.verdict], error: null })),
        })),
      }], skipDuplicates: true });
    }
  }
}

/**
 * A measured verdict for every category but Video (`DEV_UPSTREAM_VERDICTS`), for the
 * household and each group, so the DNS-derived mark states are visible without a real
 * resolver — the same reason the mock household exists.
 */
export async function ensureMockUpstreamChecks() {
  const groups = await prisma().group.findMany({ select: { id: true } });
  await writeUpstreamChecks(DEV_UPSTREAM_VERDICTS, [null, ...groups.map((group) => group.id)]);
}

/**
 * Replaces one group's checks with `verdicts`, for a browser spec that needs a state the
 * household does not report; `null` gives it back the household's. A group's own check
 * outranks the household's, and categories it omits fall back to them.
 */
export async function seedGroupUpstreamChecks(groupId: string, verdicts: readonly DevVerdict[] | null) {
  await prisma().upstreamCheck.deleteMany({ where: { groupId } });
  await writeUpstreamChecks(verdicts ?? DEV_UPSTREAM_VERDICTS, [groupId]);
}

/** Populate the household in `dev-household.ts` and mock UniFi so the UI is usable without a console. */
export async function ensureDevDummyData() {
  if (!unifiMockEnabled()) return;
  await ensureMockUnifiConnection();
  await ensureDummyHouseholdMembers();
  await ensureMockUpstreamChecks();
}
