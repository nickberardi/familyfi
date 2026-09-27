import { UpstreamVerdict } from "@prisma/client";
import { UPSTREAM_PROBE_CONCURRENCY } from "@/lib/upstream-domains";
import { prisma } from "../db";
import { dohResolver, probeDomains, type DohResolver, type DomainProbe } from "./doh";
import { plainDnsResolver } from "./plain-dns";
import { contextKey, refreshResolverContexts, type ResolverContext } from "./discovery";
import { rollUpVerdict, type VerdictRollup } from "./verdict";
import { withUpstreamLock } from "./transaction";

export type ProbeOutcome = {
  categoryId: string;
  slug: string;
  groupId: string | null;
  verdict: UpstreamVerdict;
  blockedCount: number;
  totalCount: number;
};

export type ServerCheck = VerdictRollup & { address: string; error: string | null; results: DomainProbe[] };
export type NetworkCheck = {
  id: string;
  name: string;
  verdict: UpstreamVerdict;
  servers: ServerCheck[];
  error: string | null;
};

async function activeDomains(categoryId: string): Promise<string[]> {
  const rows = await prisma().upstreamDomain.findMany({
    where: { categoryId, removedAt: null }, select: { domain: true }, orderBy: { domain: "asc" },
  });
  return rows.map((row) => row.domain);
}

function unknownResults(domains: string[]): DomainProbe[] {
  return domains.map((domain) => ({ domain, blocked: null, rcode: null, answers: [] }));
}

/** A scope is conclusive only when every server on every network agrees. */
function combineChecks(networks: NetworkCheck[], domains: string[], reason: string | null) {
  const servers = networks.flatMap((network) => network.servers);
  const error = reason ?? networks.find((network) => network.error)?.error
    ?? servers.find((server) => server.error)?.error ?? null;
  const results = domains.map((domain, index): DomainProbe => {
    const values = servers.map((server) => server.results[index]?.blocked ?? null);
    const blocked = !values.length || values.includes(null) || networks.some((network) => network.error)
      ? null : values.every((value) => value === true) ? true
        : values.every((value) => value === false) ? false : null;
    return { domain, blocked, rcode: null, answers: [] };
  });
  const rollup = rollUpVerdict(results);
  const verdict = error || servers.length === 0 || servers.some((server) => server.verdict === UpstreamVerdict.unknown)
    ? UpstreamVerdict.unknown
    : servers.every((server) => server.verdict === UpstreamVerdict.blocked)
      ? UpstreamVerdict.blocked
      : servers.every((server) => server.verdict === UpstreamVerdict.open)
        ? UpstreamVerdict.open : UpstreamVerdict.partial;
  return { results, rollup: { ...rollup, verdict }, error };
}

async function recordCheck(input: {
  categoryId: string;
  groupId: string | null;
  context?: ResolverContext;
  networkResults: NetworkCheck[];
  results: DomainProbe[];
  verdict: UpstreamVerdict;
  blockedCount: number;
  totalCount: number;
  durationMs: number;
  error: string | null;
  startedAt: Date;
}) {
  const payload = {
    verdict: input.verdict, blockedCount: input.blockedCount, totalCount: input.totalCount,
    results: input.results.map((result) => ({
      domain: result.domain, blocked: result.blocked, rcode: result.rcode,
      ...(result.reason ? { reason: result.reason } : {}),
    })),
    resolverContext: input.context ?? { source: "doh", url: "injected", networks: [], reason: null },
    networkResults: input.networkResults,
    durationMs: input.durationMs, error: input.error,
  };
  return withUpstreamLock(async (tx) => {
    const [household, category] = await Promise.all([
      tx.household.findUniqueOrThrow({ where: { id: "default" }, select: { dohProbeDisabledAt: true } }),
      tx.upstreamCategory.findUnique({ where: { id: input.categoryId }, select: { disabledAt: true } }),
    ]);
    if (!category || (household.dohProbeDisabledAt && household.dohProbeDisabledAt >= input.startedAt)
      || (category.disabledAt && category.disabledAt >= input.startedAt)) return false;
    if (input.context) {
      const owner = input.groupId === null
        ? await tx.household.findUnique({ where: { id: "default" }, select: { upstreamResolverSnapshot: true } })
        : await tx.group.findUnique({ where: { id: input.groupId }, select: { upstreamResolverSnapshot: true } });
      if (!owner || contextKey(owner.upstreamResolverSnapshot) !== contextKey(input.context)) return false;
    }
    const updated = await tx.upstreamCheck.updateMany({
      where: { categoryId: input.categoryId, groupId: input.groupId },
      data: { ...payload, checkedAt: new Date() },
    });
    if (updated.count === 0) {
      await tx.upstreamCheck.create({ data: { categoryId: input.categoryId, groupId: input.groupId, ...payload } });
    }
    return true;
  });
}

export async function probeCategory(
  categoryId: string,
  options: { resolve?: DohResolver; dnsResolver?: (server: string) => DohResolver; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<ProbeOutcome[]> {
  const probeStartedAt = new Date();
  const category = await prisma().upstreamCategory.findUnique({
    where: { id: categoryId }, select: { id: true, slug: true },
  });
  if (!category) throw Object.assign(new Error("Category not found."), { code: "not_found", status: 404 });
  const domains = await activeDomains(category.id);
  const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" }, select: { dohProbeTimeoutMs: true, dohUrl: true } });
  const timeoutMs = options.timeoutMs ?? household.dohProbeTimeoutMs;
  const contexts = options.resolve ? null : await refreshResolverContexts();
  const targets: { groupId: string | null; context?: ResolverContext }[] = options.resolve
    ? [{ groupId: null }]
    : [{ groupId: null, context: contexts!.household },
      ...[...contexts!.groups.entries()]
        .filter(([, context]) => context.source !== "doh" || context.url !== household.dohUrl)
        .map(([groupId, context]) => ({ groupId, context }))];
  const cache = new Map<string, Promise<DomainProbe[]>>();
  const query = (key: string, resolve: DohResolver) => {
    if (!cache.has(key)) cache.set(key, probeDomains(domains, resolve, UPSTREAM_PROBE_CONCURRENCY));
    return cache.get(key)!;
  };
  const outcomes: ProbeOutcome[] = [];
  for (const target of targets) {
    const started = Date.now();
    let results: DomainProbe[];
    const networkResults: NetworkCheck[] = [];
    let verdict: UpstreamVerdict;
    let blockedCount: number;
    let totalCount: number;
    let error: string | null;
    if (options.resolve || target.context?.source === "doh") {
      const url = target.context?.url ?? "injected";
      results = await query(`doh:${url}`, options.resolve ?? dohResolver({ resolverUrl: url, timeoutMs, fetchImpl: options.fetchImpl }));
      const rollup = rollUpVerdict(results);
      ({ verdict, blockedCount, totalCount } = rollup);
      error = results.find((result) => result.error)?.error ?? null;
    } else if (target.context?.source === "dhcp") {
      for (const network of target.context.networks) {
        const servers: ServerCheck[] = [];
        for (const address of network.servers) {
          const serverResults = await query(`dns:${address}`, options.dnsResolver?.(address)
            ?? plainDnsResolver({ server: address, timeoutMs }));
          servers.push({ address, results: serverResults, ...rollUpVerdict(serverResults),
            error: serverResults.find((result) => result.error)?.error ?? null });
        }
        networkResults.push({ id: network.id, name: network.name, servers,
          verdict: network.reason || !servers.length || servers.some((server) => server.verdict === UpstreamVerdict.unknown)
            ? UpstreamVerdict.unknown
            : servers.every((server) => server.verdict === UpstreamVerdict.blocked) ? UpstreamVerdict.blocked
              : servers.every((server) => server.verdict === UpstreamVerdict.open) ? UpstreamVerdict.open
                : UpstreamVerdict.partial,
          error: network.reason ?? servers.find((server) => server.error)?.error ?? null });
      }
      const combined = combineChecks(networkResults, domains, target.context.reason);
      results = combined.results;
      ({ verdict, blockedCount, totalCount } = combined.rollup);
      error = combined.error;
    } else {
      results = unknownResults(domains);
      ({ verdict, blockedCount, totalCount } = rollUpVerdict(results));
      error = target.context?.reason ?? "No resolver could be determined.";
    }
    const saved = await recordCheck({ categoryId: category.id, groupId: target.groupId,
      context: target.context, networkResults, results, verdict, blockedCount, totalCount,
      durationMs: Date.now() - started, error, startedAt: probeStartedAt });
    if (saved) outcomes.push({ categoryId: category.id, slug: category.slug,
      groupId: target.groupId, verdict, blockedCount, totalCount });
  }
  return outcomes;
}

export async function probeEnabledCategories(
  options: { resolve?: DohResolver; dnsResolver?: (server: string) => DohResolver; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<ProbeOutcome[]> {
  const categories = await prisma().upstreamCategory.findMany({
    where: { enabled: true }, select: { id: true }, orderBy: { label: "asc" },
  });
  const outcomes: ProbeOutcome[] = [];
  for (const category of categories) outcomes.push(...await probeCategory(category.id, options));
  return outcomes;
}
