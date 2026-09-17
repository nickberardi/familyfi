import { UpstreamVerdict } from "@prisma/client";
import { UPSTREAM_PROBE_CONCURRENCY } from "@/lib/upstream-domains";
import { prisma } from "../db";
import { dohResolver, probeDomains, type DohResolver, type DomainProbe } from "./doh";
import { ResolverConfigError, householdResolverUrl } from "./resolver-settings";
import { rollUpVerdict } from "./verdict";

export type ProbeOutcome = {
  categoryId: string;
  slug: string;
  verdict: UpstreamVerdict;
  blockedCount: number;
  totalCount: number;
};

/**
 * Category sweeps use the household endpoint. A group override changes which resolver
 * that group's devices are pointed at; it does not yet produce a separate verdict,
 * because `UpstreamCheck` is keyed one row per category. Per-group verdicts would
 * need a composite key and a sweep per distinct endpoint.
 */
async function resolverForSweep(timeoutMs: number, fetchImpl?: typeof fetch): Promise<DohResolver> {
  const household = await prisma().household.findUnique({ where: { id: "default" } });
  if (!household) throw new ResolverConfigError("Household is not set up.");
  const resolverUrl = householdResolverUrl(household);
  if (!resolverUrl) {
    throw new ResolverConfigError("Set a DNS-over-HTTPS endpoint in Categories first.");
  }
  return dohResolver({ resolverUrl, timeoutMs: timeoutMs || household.dohProbeTimeoutMs, fetchImpl });
}

/** Active domains only — a struck-through seeded domain is not queried. */
async function activeDomains(categoryId: string): Promise<string[]> {
  const rows = await prisma().upstreamDomain.findMany({
    where: { categoryId, removedAt: null },
    select: { domain: true },
    orderBy: { domain: "asc" },
  });
  return rows.map((row) => row.domain);
}

async function recordCheck(
  categoryId: string,
  results: DomainProbe[],
  durationMs: number,
  error: string | null,
) {
  const rollup = rollUpVerdict(results);
  await prisma().upstreamCheck.upsert({
    where: { categoryId },
    create: {
      categoryId,
      verdict: rollup.verdict,
      blockedCount: rollup.blockedCount,
      totalCount: rollup.totalCount,
      results: results.map((result) => ({
        domain: result.domain,
        blocked: result.blocked,
        rcode: result.rcode,
      })),
      durationMs,
      error,
    },
    update: {
      verdict: rollup.verdict,
      blockedCount: rollup.blockedCount,
      totalCount: rollup.totalCount,
      results: results.map((result) => ({
        domain: result.domain,
        blocked: result.blocked,
        rcode: result.rcode,
      })),
      checkedAt: new Date(),
      durationMs,
      error,
    },
  });
  return rollup;
}

export async function probeCategory(
  categoryId: string,
  options: { resolve?: DohResolver; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<ProbeOutcome> {
  const category = await prisma().upstreamCategory.findUnique({
    where: { id: categoryId },
    select: { id: true, slug: true },
  });
  if (!category) throw Object.assign(new Error("Category not found."), { code: "not_found", status: 404 });

  const domains = await activeDomains(category.id);
  const started = Date.now();
  let resolve: DohResolver;
  try {
    resolve = options.resolve ?? (await resolverForSweep(options.timeoutMs ?? 0, options.fetchImpl));
  } catch (error) {
    // No endpoint configured: unknown, never open.
    const message = error instanceof Error ? error.message : String(error);
    const rollup = await recordCheck(
      category.id,
      domains.map((domain) => ({ domain, blocked: null, rcode: null, answers: [] })),
      Date.now() - started,
      message,
    );
    return { categoryId: category.id, slug: category.slug, ...rollup };
  }

  const results = await probeDomains(domains, resolve, UPSTREAM_PROBE_CONCURRENCY);
  const firstError = results.find((result) => result.error)?.error ?? null;
  const rollup = await recordCheck(category.id, results, Date.now() - started, firstError);
  return { categoryId: category.id, slug: category.slug, ...rollup };
}

/** One pass over every category with checking on. Disabled ones keep their last result. */
export async function probeEnabledCategories(
  options: { resolve?: DohResolver; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<ProbeOutcome[]> {
  const categories = await prisma().upstreamCategory.findMany({
    where: { enabled: true },
    select: { id: true },
    orderBy: { label: "asc" },
  });
  const outcomes: ProbeOutcome[] = [];
  for (const category of categories) {
    outcomes.push(await probeCategory(category.id, options));
  }
  return outcomes;
}
