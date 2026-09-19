import { describe, expect, it } from "vitest";
import { domainVerdict, domainVerdictStyle, type UpstreamCheckRow, type UpstreamDomainRow } from "@/lib/upstream";

function domain(overrides: Partial<UpstreamDomainRow> = {}): Pick<UpstreamDomainRow, "domain" | "removed"> {
  return { domain: "example.com", removed: false, ...overrides };
}

function check(results: UpstreamCheckRow["results"]): UpstreamCheckRow {
  return {
    verdict: "partial",
    blockedCount: 0,
    totalCount: results.length,
    checkedAt: "2026-09-19T12:00:00.000Z",
    error: null,
    groupId: null,
    results,
  };
}

describe("domainVerdict", () => {
  it("is blocked when the sweep found it blocked", () => {
    expect(domainVerdict(domain(), check([{ domain: "example.com", blocked: true }]))).toBe("blocked");
  });

  it("is open when the sweep resolved it and it was not blocked", () => {
    expect(domainVerdict(domain(), check([{ domain: "example.com", blocked: false }]))).toBe("open");
  });

  it("is unknown when nothing has been checked at all", () => {
    expect(domainVerdict(domain(), null)).toBe("unknown");
  });

  it("is unknown when the domain is absent from the sweep's results", () => {
    // Added after the last sweep, or never included — either way, unmeasured.
    expect(domainVerdict(domain({ domain: "new.example" }), check([{ domain: "example.com", blocked: true }]))).toBe(
      "unknown",
    );
  });

  it("is unknown when the resolver could not resolve this domain", () => {
    expect(domainVerdict(domain(), check([{ domain: "example.com", blocked: null }]))).toBe("unknown");
  });

  /**
   * The one case a naive lookup gets wrong: removal doesn't touch a check taken
   * before it, so a stale "blocked: true" can still be sitting in `results`. A
   * struck-through row must never show it.
   */
  it("is unknown for a removed domain even if a stale result still says blocked", () => {
    expect(domainVerdict(domain({ removed: true }), check([{ domain: "example.com", blocked: true }]))).toBe(
      "unknown",
    );
  });
});

describe("domainVerdictStyle", () => {
  it("shares the same labels as the category-level verdict chip", () => {
    expect(domainVerdictStyle(domain(), check([{ domain: "example.com", blocked: true }])).label).toBe(
      "Blocked upstream",
    );
    expect(domainVerdictStyle(domain(), check([{ domain: "example.com", blocked: false }])).label).toBe(
      "Not blocked",
    );
    expect(domainVerdictStyle(domain(), null).label).toBe("Not checked");
  });
});
