import { UpstreamVerdict } from "@prisma/client";
import type { DomainProbe } from "./doh";

export type VerdictRollup = {
  verdict: UpstreamVerdict;
  blockedCount: number;
  totalCount: number;
};

/**
 * Roll per-domain results into one verdict.
 *
 * - every domain blocked  → `blocked`
 * - some blocked          → `partial`
 * - none blocked          → `open`
 * - any domain unobserved → `unknown`, whatever the rest said
 *
 * That last rule is the important one. A domain we could not resolve is a failure to
 * observe, not an observation, so one unreachable query poisons the category rather
 * than being quietly counted as "not blocked". Reporting `open` off a failed sweep
 * would tell a parent nothing is filtered when the truth is that we do not know, and
 * reporting `blocked` would be a false assurance — the worse of the two.
 *
 * An empty list is `unknown` as well: there is nothing to conclude from no evidence.
 */
export function rollUpVerdict(results: DomainProbe[]): VerdictRollup {
  const totalCount = results.length;
  const blockedCount = results.filter((result) => result.blocked === true).length;
  if (totalCount === 0) return { verdict: UpstreamVerdict.unknown, blockedCount: 0, totalCount: 0 };
  if (results.some((result) => result.blocked === null)) {
    return { verdict: UpstreamVerdict.unknown, blockedCount, totalCount };
  }
  if (blockedCount === totalCount) {
    return { verdict: UpstreamVerdict.blocked, blockedCount, totalCount };
  }
  if (blockedCount === 0) return { verdict: UpstreamVerdict.open, blockedCount, totalCount };
  return { verdict: UpstreamVerdict.partial, blockedCount, totalCount };
}

/** The line under the verdict chip. Mirrors the design prototype's wording. */
export function verdictDetail(rollup: VerdictRollup, error: string | null): string {
  if (rollup.verdict === UpstreamVerdict.unknown) {
    return error ? `Last check couldn't reach the resolver — ${error}` : "Last check couldn't reach the resolver";
  }
  return `${rollup.blockedCount} of ${rollup.totalCount} test domains blocked`;
}
