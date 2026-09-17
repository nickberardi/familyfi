/**
 * DNS-over-HTTPS probe client, RFC 8484.
 *
 * Wire format (`application/dns-message`) over POST, which RFC 8484 requires every
 * conforming resolver to accept. That is the whole reason to prefer it: the probe
 * works against any DoH endpoint a household points it at, with no per-provider
 * response shape to guess.
 */

import {
  RCODE_NXDOMAIN,
  TYPE_A,
  TYPE_AAAA,
  decodeResponse,
  encodeQuery,
  type DnsResponse,
} from "./dns-message";

export const DNS_MESSAGE_MEDIA_TYPE = "application/dns-message";

/** Per-domain outcome. `blocked: null` is a failure to observe, never an observation. */
export type DomainProbe = {
  domain: string;
  blocked: boolean | null;
  rcode: number | null;
  answers: string[];
  /** The resolver's own words when it sent an EDE, e.g. "Blocked by …: category:porn". */
  reason?: string;
  error?: string;
};

export type DohResolver = (domain: string) => Promise<DomainProbe>;

/**
 * Addresses a filtering resolver returns to mean "nothing here". Emitted in the
 * canonical forms `dns-message.ts` produces, plus the compressed IPv6 spelling in
 * case an address reaches this predicate from elsewhere.
 */
const SINKHOLE = new Set(["0.0.0.0", "0:0:0:0:0:0:0:0", "::"]);

/**
 * RFC 8914 info-codes that mean the resolver deliberately withheld this name:
 * 15 Blocked (internal policy), 16 Censored (external requirement), 17 Filtered
 * (blocked as the client asked). 18 Prohibited is deliberately absent — it says the
 * client is not allowed to query at all, which would apply to every name equally and
 * is an access failure rather than a verdict about this one.
 */
const FILTERED_INFO_CODES = new Set([15, 16, 17]);

/**
 * True when the response says this name is filtered. Any one of:
 *
 * - an Extended DNS Error marking it Blocked, Censored or Filtered
 * - NXDOMAIN — the resolver denies the name exists
 * - every address is a sinkhole (`0.0.0.0` / `::`)
 * - NOERROR with no address record at all (NODATA), including a CNAME that leads
 *   nowhere
 *
 * **The EDE branch is the one that matters in practice, not a nicety.** A real
 * NextDNS profile answers a blocked name with NOERROR *and a routable address* — the
 * address of its block page — so none of the three heuristics below fire and the name
 * looks perfectly ordinary. Only the EDE says otherwise. Providers that sinkhole or
 * NXDOMAIN instead (Pi-hole, AdGuard Home, Cloudflare for Families) are covered by
 * the heuristics, so both paths earn their place.
 *
 * NXDOMAIN is also how a domain that has ceased to exist answers, which is why the
 * shipped canaries were liveness-checked: a dead canary would otherwise be counted as
 * blocked and inflate the verdict.
 */
export function isBlockedResponse(response: DnsResponse): boolean {
  if (response.extendedError && FILTERED_INFO_CODES.has(response.extendedError.infoCode)) {
    return true;
  }
  if (response.rcode === RCODE_NXDOMAIN) return true;
  if (response.addresses.length === 0) return true;
  return response.addresses.every((answer) => SINKHOLE.has(answer.address));
}

export function answerAddresses(response: DnsResponse): string[] {
  return response.addresses.map((answer) => answer.address);
}

function randomId(): number {
  return Math.floor(Math.random() * 0x10000);
}

/**
 * Binds a resolver to one endpoint. Queries A first and only asks for AAAA when the
 * A answer looks filtered, so a household running IPv4-only does not get a false
 * `blocked` from a name that simply has no A record.
 */
export function dohResolver(input: {
  resolverUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}): DohResolver {
  const doFetch = input.fetchImpl ?? fetch;

  async function ask(domain: string, type: number): Promise<DnsResponse> {
    const id = randomId();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const response = await doFetch(input.resolverUrl, {
        method: "POST",
        headers: {
          "content-type": DNS_MESSAGE_MEDIA_TYPE,
          accept: DNS_MESSAGE_MEDIA_TYPE,
        },
        body: encodeQuery(domain, type, id),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const decoded = decodeResponse(new Uint8Array(await response.arrayBuffer()));
      // A mismatched id means this answer is not for the question we asked.
      if (decoded.id !== id) throw new Error("Response id did not match the query.");
      return decoded;
    } finally {
      clearTimeout(timer);
    }
  }

  return async (domain: string): Promise<DomainProbe> => {
    try {
      const v4 = await ask(domain, TYPE_A);
      if (!isBlockedResponse(v4)) {
        return { domain, blocked: false, rcode: v4.rcode, answers: answerAddresses(v4) };
      }
      // An EDE, NXDOMAIN or a sinkholed address all settle the name on their own.
      // Only NODATA is ambiguous: a name with no A record may still be reachable over
      // IPv6, so that is the one case worth a second query.
      const ambiguous =
        !v4.extendedError && v4.rcode !== RCODE_NXDOMAIN && v4.addresses.length === 0;
      if (!ambiguous) {
        return {
          domain,
          blocked: true,
          rcode: v4.rcode,
          answers: answerAddresses(v4),
          reason: v4.extendedError?.text || undefined,
        };
      }
      const v6 = await ask(domain, TYPE_AAAA);
      return {
        domain,
        blocked: isBlockedResponse(v6),
        rcode: v6.rcode,
        answers: answerAddresses(v6),
        reason: v6.extendedError?.text || undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { domain, blocked: null, rcode: null, answers: [], error: message };
    }
  };
}

/** Resolves `domains` with at most `concurrency` requests in flight, input order kept. */
export async function probeDomains(
  domains: string[],
  resolve: DohResolver,
  concurrency: number,
): Promise<DomainProbe[]> {
  const results = new Array<DomainProbe>(domains.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, domains.length)) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= domains.length) return;
      results[index] = await resolve(domains[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export { TYPE_A, TYPE_AAAA };
