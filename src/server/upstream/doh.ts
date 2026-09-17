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
 * True when the response says this name is filtered. Any one of:
 *
 * - NXDOMAIN — the resolver denies the name exists
 * - every address is a sinkhole (`0.0.0.0` / `::`)
 * - NOERROR with no address record at all (NODATA), including a CNAME that leads
 *   nowhere
 *
 * NXDOMAIN is also how a domain that has ceased to exist answers, which is why the
 * shipped canaries were liveness-checked: a dead canary would otherwise be counted as
 * blocked and inflate the verdict.
 */
export function isBlockedResponse(response: DnsResponse): boolean {
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
      // NXDOMAIN is authoritative for the whole name, so AAAA cannot contradict it.
      if (v4.rcode === RCODE_NXDOMAIN) {
        return { domain, blocked: true, rcode: v4.rcode, answers: [] };
      }
      const v6 = await ask(domain, TYPE_AAAA);
      const blocked = isBlockedResponse(v6);
      return {
        domain,
        blocked,
        rcode: v6.rcode,
        answers: [...answerAddresses(v4), ...answerAddresses(v6)],
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
