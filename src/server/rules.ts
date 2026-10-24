import { GroupKind, Prisma, RuleKind, RuleLiftKind, RuleMode, RuleScope } from "@prisma/client";
import { z } from "zod";
import { encryptedDnsHosts } from "@/lib/encrypted-dns";
import { LOCK_DNS_PARTS, lockDnsPolicyName, rulePolicyNames } from "@/lib/policy-names";
import { isCountryCode, RECOMMENDED_BLOCKED_COUNTRIES } from "@/lib/countries";
import {
  alwaysWindow,
  COUNTRIES_RULE_ID,
  LOCK_DNS_RULE_ID,
  MAX_RULE_DOMAINS,
  MAX_RULE_NAME,
  MAX_RULE_WINDOWS,
  MAX_WINDOW_NAME,
  normalizeDomain,
  QUARANTINE_RULE_ID,
  type BuiltInRule,
} from "@/lib/rules";
import type { InternetWindow } from "@/lib/rule-windows";
import { assertSchedule } from "@/lib/schedule";
import { prisma } from "./db";
import { quarantinePolicyName } from "./unifi/names";
import { networkInScope, type NetworkScope } from "./unifi/scope";

// A group's and a rule's allow share it with the clients.
export { activeWindowsEnd } from "@/lib/rules";

export const ruleInclude = {
  groups: true,
  windows: { orderBy: { position: "asc" } },
} satisfies Prisma.RuleInclude;

export type RuleWithWindows = Prisma.RuleGetPayload<{ include: typeof ruleInclude }>;

export type PublicRule = ReturnType<typeof publicRule>;

type LiftColumns = {
  pauseActive: boolean;
  pauseUntil: Date | null;
  pauseKind: RuleLiftKind;
  pausedByAccountId: string | null;
  pausedByName: string | null;
};

function publicPause(state: LiftColumns) {
  return {
    active: state.pauseActive,
    until: state.pauseUntil?.toISOString() ?? null,
    kind: state.pauseKind,
    by: state.pausedByName ? { accountId: state.pausedByAccountId, name: state.pausedByName } : null,
  };
}

/**
 * The rule as the API shows it. The built-in quarantine rule is on while the household enforces
 * quarantine (`quarantineEnforced`), which callers pass; `presentRules` reads it for them. Lock DNS
 * shows the encrypted DNS services' host names it blocks as its `domains`.
 */
export function publicRule(rule: RuleWithWindows, quarantineEnforced: boolean) {
  const windows = [...rule.windows].sort((a, b) => a.position - b.position);
  const builtIn = builtInRule(rule);
  const quarantine = builtIn === "quarantine";
  return {
    id: rule.id,
    name: rule.name,
    kind: rule.kind,
    scope: rule.scope,
    groupIds: rule.groups.map((link) => link.groupId).sort(),
    networkIds: [...rule.networkIds],
    targetIds: [...rule.targetIds],
    domains: builtIn === "dns" ? encryptedDnsHosts() : [...rule.domains],
    countries: [...rule.countries],
    enabled: quarantine ? quarantineEnforced : rule.enabled,
    pause: publicPause(rule),
    groupPauses: rule.groups
      .filter((link) => link.pauseActive)
      .map((link) => ({ groupId: link.groupId, pause: publicPause(link) }))
      .sort((a, b) => a.groupId.localeCompare(b.groupId)),
    mode: rule.mode,
    windows: windows.map((window) => ({
      id: window.id,
      name: window.name,
      days: [...window.days],
      start: window.start,
      end: window.end,
    })),
    useGeneratedName: rule.useGeneratedName,
    /** What UniFi's policy table shows for this rule, one per policy in the Internal zone. */
    policyNames: quarantine
      ? [quarantinePolicyName("Internal")]
      : builtIn === "dns"
        ? LOCK_DNS_PARTS.map((part) => lockDnsPolicyName(part))
        : rulePolicyNames({ ...rule, windows }),
    builtIn,
  };
}

/** The rules as the API shows them, reading the household's quarantine switch when one is built in. */
export async function presentRules(rules: RuleWithWindows[]) {
  const enforced = rules.some(isQuarantineRule)
    ? (await prisma().household.findUniqueOrThrow({ where: { id: "default" } })).quarantineEnforced
    : false;
  return rules.map((rule) => publicRule(rule, enforced));
}

export async function presentRule(rule: RuleWithWindows) {
  return (await presentRules([rule]))[0]!;
}

export function isQuarantineRule(rule: Pick<RuleWithWindows, "id">): boolean {
  return rule.id === QUARANTINE_RULE_ID;
}

export function isLockDnsRule(rule: Pick<RuleWithWindows, "id">): boolean {
  return rule.id === LOCK_DNS_RULE_ID;
}

/** Which rule FamilyFi provides this is, or null for one of the household's own. */
export function builtInRule(rule: Pick<RuleWithWindows, "id">): BuiltInRule | null {
  if (rule.id === QUARANTINE_RULE_ID) return "quarantine";
  if (rule.id === LOCK_DNS_RULE_ID) return "dns";
  if (rule.id === COUNTRIES_RULE_ID) return "countries";
  return null;
}

/**
 * The household's built-in quarantine rule, created beside the household. It holds only the
 * quarantine pause: whether quarantine is on is `Household.quarantineEnforced`, so the row's own
 * `enabled` stays true, and its policies are the quarantine `AppPolicy` rows, never `RulePolicy`.
 */
export async function ensureQuarantineRule(): Promise<void> {
  await prisma().rule.upsert({
    where: { id: QUARANTINE_RULE_ID },
    update: {},
    create: { id: QUARANTINE_RULE_ID, name: "Quarantine", kind: RuleKind.internet, mode: RuleMode.always },
  });
}

/**
 * The household's built-in Lock DNS rule, created beside the household, off and covering no group.
 * Its policies are ordinary `RulePolicy` rows, one per part (`LOCK_DNS_PARTS`) in each zone, so
 * reconciliation, pauses and allowances treat it as any always-on rule. Its stored `kind` and
 * `domains` are never read: what it blocks is the encrypted DNS seed.
 */
export async function ensureLockDnsRule(): Promise<void> {
  await prisma().rule.upsert({
    where: { id: LOCK_DNS_RULE_ID },
    update: {},
    create: { id: LOCK_DNS_RULE_ID, name: "Lock DNS", kind: RuleKind.domain, mode: RuleMode.always, enabled: false },
  });
}

/**
 * The household's built-in Block countries rule, created off beside the household with the
 * recommended countries and no groups: it is a website-kind rule only so that no client meets an
 * unknown kind and nothing counts it as an internet rule; its policies block by region, not domain.
 * Switching it on with no groups covers every group (`/rules/countries/on`).
 */
export async function ensureCountriesRule(db: Pick<Prisma.TransactionClient, "rule"> = prisma()): Promise<void> {
  await db.rule.upsert({
    where: { id: COUNTRIES_RULE_ID },
    update: {},
    create: {
      id: COUNTRIES_RULE_ID,
      name: "Block countries",
      kind: RuleKind.domain,
      mode: RuleMode.always,
      enabled: false,
      countries: [...RECOMMENDED_BLOCKED_COUNTRIES],
    },
  });
}

/** A Block countries list as the rule stores it: known codes, upper case, sorted, at least one. */
export function normalizeCountries(raw: string[]): string[] {
  const codes = [...new Set(raw.map((code) => code.trim().toUpperCase()))].sort();
  const unknown = codes.filter((code) => !isCountryCode(code));
  if (unknown.length) throw new RuleInputError(400, "invalid_countries", `Unknown country code: ${unknown.join(", ")}`);
  if (codes.length === 0) throw new RuleInputError(400, "invalid_countries", "Pick at least one country.");
  return codes;
}

/** What Lock DNS and Block countries take: their switch, what they apply to, and Block countries' countries. */
export type BuiltInRulePatch = {
  enabled?: boolean;
  scope?: "group" | "network";
  groupIds?: string[];
  networkIds?: string[];
  countries?: string[];
};

/**
 * Saves Lock DNS's or Block countries' switch and what it applies to, checked as any rule's are:
 * people and things, or whole managed networks. A patch that names only groups, or only networks,
 * takes that scope, so a client that knows only groups moves the rule back to them. Switched on
 * while it applies to nothing, Lock DNS covers every person (things like smart TVs often insist on
 * their own DNS) and Block countries every group, unless the same patch names the groups. A group
 * it stops covering takes its allowance with it. Off ends a pause, as for every rule. The caller
 * enqueues the change.
 */
export async function saveBuiltInRule(
  id: typeof LOCK_DNS_RULE_ID | typeof COUNTRIES_RULE_ID,
  patch: BuiltInRulePatch,
  networkScope: () => Promise<{ scope: NetworkScope; known?: Set<string> }> = householdNetworkScope,
): Promise<RuleWithWindows> {
  const countries = id === COUNTRIES_RULE_ID && patch.countries ? normalizeCountries(patch.countries) : undefined;
  const named = patch.scope ?? (patch.networkIds && !patch.groupIds ? RuleScope.network : patch.groupIds && !patch.networkIds ? RuleScope.group : undefined);
  // A new list of networks is checked against the site before the lock, which the site can't be read under.
  if (patch.networkIds && named === RuleScope.network) {
    const { scope: managed, known } = await networkScope();
    assertManagedNetworkIds(patch.networkIds, managed, known);
  }
  return prisma().$transaction(async (tx) => {
    await lockHousehold(tx);
    // What the patch leaves out comes from the rule as it is now, so a concurrent edit of it stands.
    const rule = await tx.rule.findUniqueOrThrow({ where: { id }, include: { groups: true } });
    const scope = named ?? rule.scope;
    // Unchanged networks were valid when saved; switching to networks without naming any is refused.
    const networkIds =
      scope === RuleScope.network ? normalizeNetworkIds(patch.networkIds ?? (rule.scope === RuleScope.network ? rule.networkIds : [])) : [];
    const enabled = patch.enabled ?? rule.enabled;
    let groupIds: string[] = [];
    if (scope === RuleScope.group) {
      groupIds = patch.groupIds ? [...new Set(patch.groupIds)].sort() : rule.scope === RuleScope.group ? rule.groups.map((link) => link.groupId) : [];
      if (patch.groupIds && groupIds.length === 0 && id === COUNTRIES_RULE_ID) {
        throw new RuleInputError(400, "invalid_groups", "Pick at least one person or thing the rule applies to.");
      }
      const found = await tx.group.count({ where: { id: { in: groupIds } } });
      if (found !== groupIds.length) throw new RuleInputError(404, "not_found", "Group not found.");
      if (enabled && groupIds.length === 0 && !patch.groupIds) {
        const defaults = await tx.group.findMany({ where: id === LOCK_DNS_RULE_ID ? { kind: GroupKind.family } : {}, select: { id: true } });
        groupIds = defaults.map((group) => group.id);
      }
    }
    await tx.rule.update({
      where: { id },
      data: {
        enabled,
        scope,
        networkIds,
        ...(countries ? { countries } : {}),
        ...(enabled ? {} : { pauseActive: false, pauseUntil: null, pauseKind: RuleLiftKind.pause, pausedByAccountId: null, pausedByName: null }),
      },
    });
    await tx.ruleGroup.deleteMany({ where: { ruleId: id, groupId: { notIn: groupIds } } });
    await tx.ruleGroup.createMany({ data: groupIds.map((groupId) => ({ ruleId: id, groupId })), skipDuplicates: true });
    return tx.rule.findUniqueOrThrow({ where: { id }, include: ruleInclude });
  });
}

/**
 * A new group joins Block countries when the rule covered every other group, so "every group, Things
 * too" stays true as the household grows. A rule narrowed to some groups, or on whole networks, is left
 * as it was.
 */
export async function joinCountriesRule(tx: Prisma.TransactionClient, groupId: string): Promise<void> {
  const rule = await tx.rule.findUnique({ where: { id: COUNTRIES_RULE_ID }, include: { groups: true } });
  const groups = await tx.group.count({ where: { id: { not: groupId } } });
  if (!rule || rule.scope === RuleScope.network) return;
  // Switched on with no groups (none existed, or all were deleted) still means every group.
  if (rule.groups.length === 0 ? !rule.enabled : rule.groups.length < groups) return;
  await tx.ruleGroup.createMany({ data: [{ ruleId: COUNTRIES_RULE_ID, groupId }], skipDuplicates: true });
}

/** Holds the household row for the rest of the transaction, serializing writes that take it. */
export async function lockHousehold(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Household" WHERE "id" = 'default' FOR UPDATE`;
}

/**
 * Turns quarantine on or off for the household, with any other household fields in `data` in the
 * same transaction. Turning it off ends a pause on it, as turning any rule off does, and so does
 * turning it on: a pause written while it was off (one that raced the switch) must not come back
 * with it. Saving it on while it already is keeps the pause. The caller enqueues the change.
 */
export async function setQuarantineEnforced(enforced: boolean, data: Prisma.HouseholdUpdateInput = {}) {
  return prisma().$transaction(async (tx) => {
    const before = await tx.household.findUniqueOrThrow({ where: { id: "default" } });
    if (enforced !== before.quarantineEnforced || !enforced) {
      await tx.rule.updateMany({
        where: { id: QUARANTINE_RULE_ID },
        data: { pauseActive: false, pauseUntil: null, pauseKind: RuleLiftKind.pause, pausedByAccountId: null, pausedByName: null },
      });
    }
    return tx.household.update({ where: { id: "default" }, data: { ...data, quarantineEnforced: enforced } });
  });
}

/** The rule's windows as the schedule sees them: an always-on rule is one window with no end. */
export function ruleInternetWindows(rule: Pick<RuleWithWindows, "name" | "mode" | "windows">): InternetWindow[] {
  return rule.mode === RuleMode.always
    ? [alwaysWindow(rule.name)]
    : [...rule.windows]
        .sort((a, b) => a.position - b.position)
        .map((window) => ({ name: window.name, days: window.days, start: window.start, end: window.end, ruleName: rule.name }));
}

const WindowBody = z.object({
  id: z.string().min(1).optional(),
  name: z.string().max(MAX_WINDOW_NAME).optional(),
  days: z.array(z.number().int().min(0).max(6)),
  start: z.string(),
  end: z.string(),
});

const Fields = {
  name: z.string(),
  kind: z.enum(["internet", "category", "app", "domain"]),
  scope: z.enum(["group", "network"]),
  groupIds: z.array(z.string().min(1)),
  networkIds: z.array(z.string().min(1)),
  // `nonnegative`, not `positive`: DPI category 0 is Messaging. See normalizeTargetIds.
  targetIds: z.array(z.number().int().nonnegative()).max(100),
  domains: z.array(z.string()).max(MAX_RULE_DOMAINS),
  enabled: z.boolean(),
  mode: z.enum(["always", "scheduled"]),
  windows: z.array(WindowBody).max(MAX_RULE_WINDOWS),
  useGeneratedName: z.boolean(),
};

export const RuleCreateBody = z
  .object(Fields)
  .partial()
  .required({ name: true, kind: true, mode: true })
  .strict();

export const RuleUpdateBody = z
  .object({ ...Fields, countries: z.array(z.string()).max(300) })
  // `scope` changes only on Lock DNS and Block countries; any other rule keeps the one it was made with.
  .omit({ kind: true })
  .partial()
  .strict();

export type RuleInput = {
  name: string;
  kind: RuleKind;
  scope: RuleScope;
  groupIds: string[];
  networkIds: string[];
  targetIds: number[];
  domains: string[];
  enabled: boolean;
  mode: RuleMode;
  windows: { id?: string; name: string; days: number[]; start: string; end: string }[];
  useGeneratedName: boolean;
};

export class RuleInputError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Validates a whole rule: the create body, or the stored rule with an update's fields laid
 * over it. Throws a RuleInputError the route turns into its response.
 */
export async function validateRule(
  input: RuleInput,
  networkScope: () => Promise<{ scope: NetworkScope; known?: Set<string> }>,
): Promise<RuleInput> {
  const shaped = validateRuleShape(input);
  if (shaped.scope === RuleScope.group) {
    const groups = await prisma().group.findMany({ where: { id: { in: shaped.groupIds } } });
    if (groups.length !== shaped.groupIds.length) throw new RuleInputError(404, "not_found", "Group not found.");
  } else {
    const { scope, known } = await networkScope();
    assertManagedNetworkIds(shaped.networkIds, scope, known);
  }
  return shaped;
}

/**
 * Everything about a rule that needs nothing stored: its name, what it blocks, its scope's shape and
 * its windows. `validateRule` adds the groups and networks it names; a household import checks those
 * against the import itself.
 */
export function validateRuleShape(input: RuleInput): RuleInput {
  const name = input.name.trim();
  if (!name || name.length > MAX_RULE_NAME) {
    throw new RuleInputError(400, "invalid_name", `A rule needs a name of 1 to ${MAX_RULE_NAME} characters.`);
  }

  let targetIds: number[] = [];
  let domains: string[] = [];
  if (input.kind === RuleKind.category || input.kind === RuleKind.app) {
    targetIds = normalizeTargetIds(input.kind, input.targetIds);
  } else if (input.kind === RuleKind.domain) {
    domains = normalizeDomains(input.domains);
  }

  // All internet can be blocked for chosen people and things, always or on a schedule,
  // but never for a whole network: that would take every device offline.
  if (input.kind === RuleKind.internet && input.scope !== RuleScope.group) {
    throw new RuleInputError(400, "invalid_scope", "All internet can't be blocked for a whole network. Choose the people and things it applies to.");
  }

  const windows = input.mode === RuleMode.scheduled ? input.windows.map(normalizeWindow) : [];
  if (input.mode === RuleMode.scheduled && windows.length === 0) {
    throw new RuleInputError(400, "invalid_schedule", "A scheduled rule needs at least one window.");
  }
  if (windows.length > MAX_RULE_WINDOWS) {
    throw new RuleInputError(400, "invalid_schedule", `A rule has at most ${MAX_RULE_WINDOWS} windows.`);
  }

  let groupIds: string[] = [];
  let networkIds: string[] = [];
  if (input.scope === RuleScope.group) {
    groupIds = [...new Set(input.groupIds)].sort();
    if (groupIds.length === 0) {
      throw new RuleInputError(400, "invalid_groups", "Pick at least one person or thing the rule applies to.");
    }
  } else {
    networkIds = normalizeNetworkIds(input.networkIds);
  }

  return { ...input, name, targetIds, domains, groupIds, networkIds, windows };
}

function normalizeWindow(window: RuleInput["windows"][number]): RuleInput["windows"][number] {
  const days = [...new Set(window.days)].sort((a, b) => a - b);
  try {
    assertSchedule({ enabled: true, days, start: window.start, end: window.end });
  } catch (error) {
    throw new RuleInputError(400, "invalid_schedule", error instanceof Error ? error.message : "Invalid window.");
  }
  return { id: window.id, name: (window.name ?? "").trim(), days, start: window.start, end: window.end };
}

function normalizeDomains(raw: string[]): string[] {
  const domains: string[] = [];
  for (const value of raw) {
    const domain = normalizeDomain(value);
    if (!domain) throw new RuleInputError(400, "invalid_domains", `“${value}” is not a website domain.`);
    if (!domains.includes(domain)) domains.push(domain);
  }
  if (domains.length === 0) throw new RuleInputError(400, "invalid_domains", "Add at least one website.");
  return domains.sort();
}

/**
 * Zero is a valid DPI id — it is the Messaging curated slot's category — so the floor
 * here is `>= 0`, not `> 0`. The old positive-only filter silently dropped it, turning
 * a Messaging rule into an empty target list and an "at least one target id" error.
 */
export function normalizeTargetIds(kind: RuleKind, raw: number[]): number[] {
  const ids = [...new Set(raw.map((n) => Math.trunc(n)).filter((n) => Number.isFinite(n) && n >= 0))].sort(
    (a, b) => a - b,
  );
  if (ids.length === 0) throw new RuleInputError(400, "invalid_targets", "At least one target id is required.");
  if (kind === RuleKind.app && ids.length > 100) {
    throw new RuleInputError(400, "invalid_targets", "App rules may target at most 100 applications.");
  }
  return ids;
}

export function normalizeNetworkIds(raw: string[]): string[] {
  const ids = [...new Set(raw.map((id) => id.trim()).filter(Boolean))].sort();
  if (ids.length === 0) throw new RuleInputError(400, "invalid_networks", "At least one network id is required.");
  return ids;
}

/** D9: network-scoped rules may only reference Settings-managed network ids. */
export function assertManagedNetworkIds(
  networkIds: string[],
  scope: NetworkScope,
  knownSiteNetworkIds?: Set<string>,
): void {
  const ids = normalizeNetworkIds(networkIds);
  if (scope.manageAllNetworks) {
    if (knownSiteNetworkIds && knownSiteNetworkIds.size === 0) {
      throw new RuleInputError(409, "empty_managed_networks", "No UniFi networks are available for Network scope.");
    }
    if (knownSiteNetworkIds) {
      const unknown = ids.filter((id) => !knownSiteNetworkIds.has(id));
      if (unknown.length) {
        throw new RuleInputError(400, "unmanaged_network", `Unknown UniFi network id: ${unknown.join(", ")}`);
      }
    }
    return;
  }
  if (scope.managedNetworkIds.length === 0) {
    throw new RuleInputError(409, "empty_managed_networks", "Network scope is disabled until managed networks are selected in Settings.");
  }
  const unmanaged = ids.filter((id) => !networkInScope(scope, id));
  if (unmanaged.length) {
    throw new RuleInputError(400, "unmanaged_network", `Unmanaged network id: ${unmanaged.join(", ")}`);
  }
}

/**
 * Writes a validated rule. Windows are matched by id, so a window kept through an edit
 * keeps its UniFi policy (renamed or rescheduled in place); a removed window's policy is
 * deleted on the next reconcile, and a new one is created.
 */
export async function saveRule(input: RuleInput, existingId?: string): Promise<RuleWithWindows> {
  return prisma().$transaction(async (tx) => {
    const data = {
      name: input.name,
      useGeneratedName: input.useGeneratedName,
      kind: input.kind,
      scope: input.scope,
      networkIds: input.networkIds,
      targetIds: input.targetIds,
      domains: input.domains,
      enabled: input.enabled,
      mode: input.mode,
      // Off and paused never overlap: turning a rule off ends its pause.
      ...(input.enabled ? {} : { pauseActive: false, pauseUntil: null, pauseKind: RuleLiftKind.pause, pausedByAccountId: null, pausedByName: null }),
    };
    const rule = existingId
      ? await tx.rule.update({ where: { id: existingId }, data })
      : await tx.rule.create({ data });
    await tx.ruleGroup.deleteMany({ where: { ruleId: rule.id, groupId: { notIn: input.groupIds } } });
    await tx.ruleGroup.createMany({
      data: input.groupIds.map((groupId) => ({ ruleId: rule.id, groupId })),
      skipDuplicates: true,
    });
    const kept = input.windows.map((window) => window.id).filter((id): id is string => Boolean(id));
    await tx.ruleWindow.deleteMany({ where: { ruleId: rule.id, id: { notIn: kept } } });
    const stored = new Set((await tx.ruleWindow.findMany({ where: { ruleId: rule.id }, select: { id: true } })).map((w) => w.id));
    for (const [position, window] of input.windows.entries()) {
      const fields = { position, name: window.name, days: window.days, start: window.start, end: window.end };
      if (window.id && stored.has(window.id)) {
        await tx.ruleWindow.update({ where: { id: window.id }, data: fields });
      } else {
        await tx.ruleWindow.create({ data: { ruleId: rule.id, ...fields } });
      }
    }
    return tx.rule.findUniqueOrThrow({ where: { id: rule.id }, include: ruleInclude });
  });
}

export { RuleScope };

/** Settings' managed networks, and the site's network ids when every network is managed. */
export async function householdNetworkScope(): Promise<{ scope: NetworkScope; known?: Set<string> }> {
  const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
  const scope = { manageAllNetworks: household.unifiManageAllNetworks, managedNetworkIds: household.unifiManagedNetworkIds };
  if (!scope.manageAllNetworks) return { scope };
  const { listSiteNetworks } = await import("./unifi-settings");
  // A rule names networks as they are on the console now, not as the last reconcile pass listed them.
  const networks = await listSiteNetworks(household, { fresh: true });
  return { scope, known: new Set(networks.map((network) => network.id)) };
}
