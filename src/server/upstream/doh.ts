/**
 * DNS-over-HTTPS probe client (RFC 8484 JSON, `application/dns-json`).
 *
 * JSON rather than wireformat so there is no new dependency. If a resolver turns out
 * not to serve `application/dns-json`, the fallback is `dns-packet` behind the same
 * `DohResolver` interface — nothing above this module needs to change.
 *
 * NOT YET CONFIRMED against a live NextDNS profile: the exact blocked-response shape
 * is unverified, because this environment has no egress to any DoH provider. The
 * predicate below covers every documented way a filtering resolver signals a block,
 * so it should hold, but `make spike SPIKE_ARGS=doh` against real hardware is what
 * settles it.
 */

/** Per-domain outcome. `unknown` is a failure to observe, never an observation. */
export type DomainProbe = {
  domain: string;
  blocked: boolean | null;
  rcode: number | null;
  answers: string[];
  error?: string;
};

export type DohResolver = (domain: string) => Promise<DomainProbe>;

type DnsJsonAnswer = { name?: string; type?: number; TTL?: number; data?: string };
type DnsJsonResponse = { Status?: number; Answer?: DnsJsonAnswer[] };

const RCODE_NXDOMAIN = 3;
const TYPE_A = 1;
const TYPE_AAAA = 28;

/** Addresses a filtering resolver returns to mean "nothing here". */
const SINKHOLE = new Set(["0.0.0.0", "::", "0:0:0:0:0:0:0:0"]);

/**
 * True when the response says this name is filtered. Any one of:
 *
 * - NXDOMAIN — the resolver denies the name exists
 * - a sinkhole address (`0.0.0.0` / `::`), which is what NextDNS returns by default
 * - NOERROR with no address record at all (NODATA)
 *
 * The NXDOMAIN case is also how a *dead* domain answers, which is why the canary
 * list is liveness-checked: a domain that has ceased to exist would otherwise be
 * counted as blocked and inflate the verdict.
 */
export function isBlockedResponse(response: DnsJsonResponse): boolean {
  if (response.Status === RCODE_NXDOMAIN) return true;
  const addresses = (response.Answer ?? []).filter(
    (answer) => answer.type === TYPE_A || answer.type === TYPE_AAAA,
  );
  if (addresses.length === 0) return true;
  return addresses.every((answer) => SINKHOLE.has((answer.data ?? "").trim()));
}

export function answerAddresses(response: DnsJsonResponse): string[] {
  return (response.Answer ?? [])
    .filter((answer) => answer.type === TYPE_A || answer.type === TYPE_AAAA)
    .map((answer) => (answer.data ?? "").trim())
    .filter(Boolean);
}

function queryUrl(resolverUrl: string, domain: string): string {
  const url = new URL(resolverUrl);
  url.searchParams.set("name", domain);
  url.searchParams.set("type", "A");
  return url.toString();
}

/**
 * Builds a resolver bound to one endpoint. A transport failure yields
 * `blocked: null` — the probe must never read "could not ask" as "not blocked".
 */
export function dohResolver(input: {
  resolverUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}): DohResolver {
  const doFetch = input.fetchImpl ?? fetch;
  return async (domain: string): Promise<DomainProbe> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const response = await doFetch(queryUrl(input.resolverUrl, domain), {
        headers: { accept: "application/dns-json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        return { domain, blocked: null, rcode: null, answers: [], error: `HTTP ${response.status}` };
      }
      const body = (await response.json()) as DnsJsonResponse;
      return {
        domain,
        blocked: isBlockedResponse(body),
        rcode: body.Status ?? null,
        answers: answerAddresses(body),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { domain, blocked: null, rcode: null, answers: [], error: message };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Resolves `domains` with at most `concurrency` requests in flight, input order preserved. */
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
