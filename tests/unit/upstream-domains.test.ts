import { describe, expect, it } from "vitest";
import {
  UPSTREAM_CATEGORIES,
  UPSTREAM_CATEGORY_DOMAINS,
  upstreamProbeDomainCount,
  type UpstreamCategory,
} from "@/lib/upstream-domains";

const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

describe("upstream canary domains", () => {
  it("covers every category with exactly twenty domains", () => {
    expect(UPSTREAM_CATEGORIES).toEqual(["adult", "video", "social", "gaming", "vpn", "messaging"]);
    for (const category of UPSTREAM_CATEGORIES) {
      expect(UPSTREAM_CATEGORY_DOMAINS[category], category).toHaveLength(20);
    }
  });

  it("keeps a daily run at 120 queries", () => {
    expect(upstreamProbeDomainCount()).toBe(120);
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
