import { describe, expect, it } from "vitest";
import {
  UPSTREAM_CATEGORIES,
  UPSTREAM_CATEGORY_DOMAINS,
  UPSTREAM_SEED_CATEGORIES,
  UPSTREAM_SEED_DOMAIN_CEILING,
  upstreamProbeDomainCount,
  type UpstreamCategory,
} from "@/lib/upstream-domains";

const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

describe("upstream canary domains", () => {
  it("covers every category without exceeding the sample ceiling", () => {
    expect(UPSTREAM_CATEGORIES).toEqual([
      "adult",
      "video",
      "social",
      "gaming",
      "vpn",
      "messaging",
      "ai",
      "gambling",
      "dating",
    ]);
    for (const category of UPSTREAM_CATEGORIES) {
      const domains = UPSTREAM_CATEGORY_DOMAINS[category];
      // A short category is fine — a weak canary costs more than a missing one.
      expect(domains.length, category).toBeGreaterThan(0);
      expect(domains.length, category).toBeLessThanOrEqual(UPSTREAM_SEED_DOMAIN_CEILING);
    }
  });

  /** The reconcile reads both, so a category present in one and not the other would half-seed. */
  it("carries seed metadata for every category and no others", () => {
    expect(UPSTREAM_SEED_CATEGORIES.map((seed) => seed.slug)).toEqual(UPSTREAM_CATEGORIES);
    for (const seed of UPSTREAM_SEED_CATEGORIES) {
      expect(seed.label.length, seed.slug).toBeGreaterThan(0);
      expect(seed.monogram, seed.slug).toMatch(/^[A-Z0-9+]{1,3}$/);
    }
  });

  /** The helper is what the scheduler budgets against, so it must not drift. */
  it("counts the domains a single run queries", () => {
    const expected = UPSTREAM_CATEGORIES.reduce(
      (total, category) => total + UPSTREAM_CATEGORY_DOMAINS[category].length,
      0,
    );
    expect(upstreamProbeDomainCount()).toBe(expected);
    expect(upstreamProbeDomainCount()).toBeLessThanOrEqual(
      UPSTREAM_CATEGORIES.length * UPSTREAM_SEED_DOMAIN_CEILING,
    );
  });

  it("stores bare lowercase hostnames — no scheme, port, path or wildcard", () => {
    for (const category of UPSTREAM_CATEGORIES) {
      for (const domain of UPSTREAM_CATEGORY_DOMAINS[category]) {
        expect(domain, `${category}/${domain}`).toMatch(DOMAIN_PATTERN);
      }
    }
  });

  it("has no duplicates inside a category", () => {
    for (const category of UPSTREAM_CATEGORIES) {
      const domains = UPSTREAM_CATEGORY_DOMAINS[category];
      expect(new Set(domains).size, category).toBe(domains.length);
    }
  });

  /**
   * Across categories a shared domain is legitimate — Snapchat is both social and
   * messaging — but it must stay deliberate, because it couples two verdicts.
   */
  it("shares domains across categories only where recorded", () => {
    const seen = new Map<string, UpstreamCategory[]>();
    for (const category of UPSTREAM_CATEGORIES) {
      for (const domain of UPSTREAM_CATEGORY_DOMAINS[category]) {
        seen.set(domain, [...(seen.get(domain) ?? []), category]);
      }
    }
    const shared = [...seen.entries()]
      .filter(([, categories]) => categories.length > 1)
      .map(([domain]) => domain)
      .sort();
    expect(shared).toEqual(["snapchat.com"]);
  });
});
