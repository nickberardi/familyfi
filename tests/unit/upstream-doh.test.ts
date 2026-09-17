import { describe, expect, it, vi } from "vitest";
import { UpstreamVerdict } from "@prisma/client";
import {
  answerAddresses,
  dohResolver,
  isBlockedResponse,
  probeDomains,
  type DomainProbe,
} from "@/server/upstream/doh";
import { rollUpVerdict, verdictDetail } from "@/server/upstream/verdict";

const A = 1;
const AAAA = 28;

function probe(domain: string, blocked: boolean | null): DomainProbe {
  return { domain, blocked, rcode: null, answers: [] };
}

describe("blocked-response predicate", () => {
  it("reads NXDOMAIN as blocked", () => {
    expect(isBlockedResponse({ Status: 3 })).toBe(true);
  });

  it("reads a sinkhole address as blocked", () => {
    expect(isBlockedResponse({ Status: 0, Answer: [{ type: A, data: "0.0.0.0" }] })).toBe(true);
    expect(isBlockedResponse({ Status: 0, Answer: [{ type: AAAA, data: "::" }] })).toBe(true);
    // Whitespace around the address must not defeat the match.
    expect(isBlockedResponse({ Status: 0, Answer: [{ type: A, data: " 0.0.0.0 " }] })).toBe(true);
  });

  it("reads NODATA as blocked", () => {
    expect(isBlockedResponse({ Status: 0, Answer: [] })).toBe(true);
    expect(isBlockedResponse({ Status: 0 })).toBe(true);
    // A CNAME with no address is still no address.
    expect(isBlockedResponse({ Status: 0, Answer: [{ type: 5, data: "elsewhere.example." }] })).toBe(true);
  });

  it("reads a real address as not blocked", () => {
    expect(isBlockedResponse({ Status: 0, Answer: [{ type: A, data: "93.184.216.34" }] })).toBe(false);
    expect(
      isBlockedResponse({ Status: 0, Answer: [{ type: AAAA, data: "2606:2800:220:1:248:1893:25c8:1946" }] }),
    ).toBe(false);
  });

  it("treats a mix of sinkhole and real addresses as not blocked", () => {
    // Only every address being a sinkhole means filtered; one routable answer works.
    expect(
      isBlockedResponse({
        Status: 0,
        Answer: [
          { type: A, data: "0.0.0.0" },
          { type: A, data: "93.184.216.34" },
        ],
      }),
    ).toBe(false);
  });

  it("extracts only address records", () => {
    expect(
      answerAddresses({
        Status: 0,
        Answer: [
          { type: 5, data: "cname.example." },
          { type: A, data: "1.2.3.4" },
          { type: AAAA, data: "::1" },
        ],
      }),
    ).toEqual(["1.2.3.4", "::1"]);
  });
});

describe("verdict rollup", () => {
  it("is blocked only when every domain is blocked", () => {
    expect(rollUpVerdict([probe("a", true), probe("b", true)])).toEqual({
      verdict: UpstreamVerdict.blocked,
      blockedCount: 2,
      totalCount: 2,
    });
  });

  it("is partial when some are blocked", () => {
    expect(rollUpVerdict([probe("a", true), probe("b", false)]).verdict).toBe(UpstreamVerdict.partial);
  });

  it("is open when none are blocked", () => {
    expect(rollUpVerdict([probe("a", false), probe("b", false)]).verdict).toBe(UpstreamVerdict.open);
  });

  /** One unobserved domain must not be laundered into "not blocked". */
  it("is unknown when any domain could not be observed", () => {
    expect(rollUpVerdict([probe("a", false), probe("b", null)]).verdict).toBe(UpstreamVerdict.unknown);
    expect(rollUpVerdict([probe("a", true), probe("b", null)]).verdict).toBe(UpstreamVerdict.unknown);
    const all = rollUpVerdict([probe("a", true), probe("b", true), probe("c", null)]);
    expect(all.verdict).toBe(UpstreamVerdict.unknown);
    // The counts still report what was seen.
    expect(all.blockedCount).toBe(2);
    expect(all.totalCount).toBe(3);
  });

  it("is unknown for an empty list", () => {
    expect(rollUpVerdict([])).toEqual({
      verdict: UpstreamVerdict.unknown,
      blockedCount: 0,
      totalCount: 0,
    });
  });

  it("describes itself the way the design does", () => {
    expect(verdictDetail(rollUpVerdict([probe("a", true), probe("b", false)]), null)).toBe(
      "1 of 2 test domains blocked",
    );
    expect(verdictDetail(rollUpVerdict([probe("a", null)]), null)).toBe(
      "Last check couldn't reach the resolver",
    );
  });
});

describe("doh resolver", () => {
  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/dns-json" },
    });
  }

  it("asks the endpoint for the name and reports the answer", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain("name=pornhub.com");
      expect(String(url)).toContain("type=A");
      return jsonResponse({ Status: 0, Answer: [{ type: A, data: "0.0.0.0" }] });
    });
    const resolve = dohResolver({
      resolverUrl: "https://dns.example.com/dns-query/profile",
      timeoutMs: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await resolve("pornhub.com");
    expect(result.blocked).toBe(true);
    expect(result.answers).toEqual(["0.0.0.0"]);
    expect(result.error).toBeUndefined();
  });

  it("preserves an existing path and query on the endpoint URL", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      seen.push(String(url));
      return jsonResponse({ Status: 0, Answer: [{ type: A, data: "1.2.3.4" }] });
    });
    const resolve = dohResolver({
      resolverUrl: "https://dns.nextdns.io/abc123/FamilyFi",
      timeoutMs: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await resolve("example.com");
    expect(seen[0]).toContain("/abc123/FamilyFi");
  });

  /** A transport failure is not evidence of anything. */
  it("returns blocked null on a non-2xx, a throw, and a timeout", async () => {
    const http500 = dohResolver({
      resolverUrl: "https://dns.example.com/dns-query",
      timeoutMs: 1000,
      fetchImpl: (async () => jsonResponse({}, 500)) as unknown as typeof fetch,
    });
    const failed = await http500("example.com");
    expect(failed.blocked).toBeNull();
    expect(failed.error).toBe("HTTP 500");

    const thrown = dohResolver({
      resolverUrl: "https://dns.example.com/dns-query",
      timeoutMs: 1000,
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    const errored = await thrown("example.com");
    expect(errored.blocked).toBeNull();
    expect(errored.error).toContain("ECONNREFUSED");
  });

  it("caps requests in flight and keeps input order", async () => {
    let inFlight = 0;
    let peak = 0;
    const resolve = async (domain: string): Promise<DomainProbe> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return probe(domain, false);
    };

    const domains = ["a.com", "b.com", "c.com", "d.com", "e.com", "f.com", "g.com"];
    const results = await probeDomains(domains, resolve, 3);
    expect(results.map((result) => result.domain)).toEqual(domains);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("handles an empty domain list without spawning workers", async () => {
    const resolve = vi.fn(async (domain: string) => probe(domain, false));
    expect(await probeDomains([], resolve, 4)).toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
  });
});
