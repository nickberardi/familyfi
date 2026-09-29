import { Prisma, RuleKind, RuleMode, RuleScope } from "@prisma/client";
import { z } from "zod";
import { rulePolicyNames } from "@/lib/policy-names";
import { MAX_RULE_DOMAINS, MAX_RULE_NAME, MAX_RULE_WINDOWS, MAX_WINDOW_NAME, normalizeDomain } from "@/lib/rules";
import { assertSchedule } from "@/lib/schedule";
import { prisma } from "./db";
import { networkInScope, type NetworkScope } from "./unifi/scope";

export const ruleInclude = {
  groups: true,
  windows: { orderBy: { position: "asc" } },
} satisfies Prisma.RuleInclude;

export type RuleWithWindows = Prisma.RuleGetPayload<{ include: typeof ruleInclude }>;

export type PublicRule = ReturnType<typeof publicRule>;

export function publicRule(rule: RuleWithWindows) {
  const windows = [...rule.windows].sort((a, b) => a.position - b.position);
  return {
    id: rule.id,
    name: rule.name,
    kind: rule.kind,
    scope: rule.scope,
    groupIds: rule.groups.map((link) => link.groupId).sort(),
    networkIds: [...rule.networkIds],
    targetIds: [...rule.targetIds],
    domains: [...rule.domains],
    enabled: rule.enabled,
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
    policyNames: rulePolicyNames({ ...rule, windows }),
  };
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
  .object(Fields)
  .omit({ kind: true, scope: true })
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

  let groupIds: string[] = [];
  let networkIds: string[] = [];
  if (input.scope === RuleScope.group) {
    groupIds = [...new Set(input.groupIds)].sort();
    if (groupIds.length === 0) {
      throw new RuleInputError(400, "invalid_groups", "Pick at least one person or thing the rule applies to.");
    }
    const groups = await prisma().group.findMany({ where: { id: { in: groupIds } } });
    if (groups.length !== groupIds.length) throw new RuleInputError(404, "not_found", "Group not found.");
  } else {
    networkIds = normalizeNetworkIds(input.networkIds);
    const { scope, known } = await networkScope();
    assertManagedNetworkIds(networkIds, scope, known);
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
  const networks = await listSiteNetworks(household);
  return { scope, known: new Set(networks.map((network) => network.id)) };
}
