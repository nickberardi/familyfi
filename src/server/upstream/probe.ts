import { UpstreamVerdict } from "@prisma/client";
import { UPSTREAM_PROBE_CONCURRENCY } from "@/lib/upstream-domains";
import { prisma } from "../db";
import { dohResolver, probeDomains, type DohResolver, type DomainProbe } from "./doh";
import { ResolverConfigError, distinctResolvers } from "./resolver-settings";
import { rollUpVerdict } from "./verdict";

export type ProbeOutcome = {
  categoryId: string;
  slug: string;
  /** Null is the household default. */
  groupId: string | null;
  verdict: UpstreamVerdict;
  blockedCount: number;
  totalCount: number;
};

/** One endpoint and the groups that read its verdict — null meaning the household. */
type ResolverTarget = { url: string; groupIds: (string | null)[] };

/**
 * Every distinct endpoint in the household: the default, plus each group override.
 * Groups sharing an endpoint share a sweep and a verdict, so the cost scales with the
 * number of *resolvers*, not the number of groups.
 */
async function sweepTargets(): Promise<{ targets: ResolverTarget[]; timeoutMs: number }> {
  const household = await prisma().household.findUnique({ where: { id: "default" } });
  if (!household) throw new ResolverConfigError("Household is not set up.");
  const groups = await prisma().group.findMany();
  const targets = distinctResolvers(household, groups);
  if (targets.length === 0) {
    throw new ResolverConfigError("Set a DNS-over-HTTPS endpoint in Categories first.");
  }
  return { targets, timeoutMs: household.dohProbeTimeoutMs };
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

async function recordCheck(input: {
  categoryId: string;
  groupId: string | null;
  results: DomainProbe[];
  durationMs: number;
  error: string | null;
}) {
  const rollup = rollUpVerdict(input.results);
  const payload = {
    verdict: rollup.verdict,
    blockedCount: rollup.blockedCount,
    totalCount: rollup.totalCount,
    results: input.results.map((result) => ({
      domain: result.domain,
      blocked: result.blocked,
      rcode: result.rcode,
      ...(result.reason ? { reason: result.reason } : {}),
    })),
    durationMs: input.durationMs,
    error: input.error,
  };
  // Not `upsert`: Prisma's compound-unique `where` types a nullable member as
  // non-null, so the household row (groupId null) cannot be addressed through it.
  // updateMany takes the null filter. The database still holds the line if two
  // sweeps race — the unique index is NULLS NOT DISTINCT.
  const updated = await prisma().upstreamCheck.updateMany({
    where: { categoryId: input.categoryId, groupId: input.groupId },
    data: { ...payload, checkedAt: new Date() },
  });
  if (updated.count === 0) {
    await prisma().upstreamCheck.create({
      data: { categoryId: input.categoryId, groupId: input.groupId, ...payload },
    });
  }
  return rollup;
}

/**
 * Sweeps one category across every distinct resolver, writing a verdict per resolver.
 * A group with no override is covered by the household row rather than a row of its own.
 */
export async function probeCategory(
  categoryId: string,
  options: { resolve?: DohResolver; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<ProbeOutcome[]> {
  const category = await prisma().upstreamCategory.findUnique({
    where: { id: categoryId },
    select: { id: true, slug: true },
  });
  if (!category) throw Object.assign(new Error("Category not found."), { code: "not_found", status: 404 });

  const domains = await activeDomains(category.id);
  const started = Date.now();

  let targets: ResolverTarget[];
  let timeoutMs = options.timeoutMs ?? 0;
  try {
    // An injected resolver is a test seam: it stands in for the household endpoint.
    if (options.resolve) {
      targets = [{ url: "injected", groupIds: [null] }];
    } else {
      const swept = await sweepTargets();
      targets = swept.targets;
      timeoutMs = timeoutMs || swept.timeoutMs;
    }
  } catch (error) {
    // No endpoint anywhere: unknown for the household, never open.
    const message = error instanceof Error ? error.message : String(error);
    const rollup = await recordCheck({
      categoryId: category.id,
      groupId: null,
      results: domains.map((domain) => ({ domain, blocked: null, rcode: null, answers: [] })),
      durationMs: Date.now() - started,
      error: message,
    });
    return [{ categoryId: category.id, slug: category.slug, groupId: null, ...rollup }];
  }

  const outcomes: ProbeOutcome[] = [];
  for (const target of targets) {
    const resolve =
      options.resolve ??
      dohResolver({ resolverUrl: target.url, timeoutMs, fetchImpl: options.fetchImpl });
    const runStarted = Date.now();
    const results = await probeDomains(domains, resolve, UPSTREAM_PROBE_CONCURRENCY);
    const firstError = results.find((result) => result.error)?.error ?? null;
    const durationMs = Date.now() - runStarted;
    // One measurement, written once per group that reads this endpoint.
    for (const groupId of target.groupIds) {
      const rollup = await recordCheck({
        categoryId: category.id,
        groupId,
        results,
        durationMs,
        error: firstError,
      });
      outcomes.push({ categoryId: category.id, slug: category.slug, groupId, ...rollup });
    }
  }
  return outcomes;
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
    outcomes.push(...(await probeCategory(category.id, options)));
  }
  return outcomes;
}
