import { describe, expect, it, vi } from "vitest";
import { UpstreamVerdict } from "@prisma/client";
import {
  RCODE_NOERROR,
  RCODE_NXDOMAIN,
  TYPE_A,
  TYPE_AAAA,
  decodeResponse,
  encodeQuery,
} from "@/server/upstream/dns-message";
import {
  DNS_MESSAGE_MEDIA_TYPE,
  dohResolver,
  isBlockedResponse,
  probeDomains,
  type DomainProbe,
} from "@/server/upstream/doh";
import { rollUpVerdict, verdictDetail } from "@/server/upstream/verdict";

const TYPE_CNAME = 5;

function probe(domain: string, blocked: boolean | null): DomainProbe {
  return { domain, blocked, rcode: null, answers: [] };
}

/**
 * Builds a wire-format response. Answer names are written as a compression pointer to
 * the question at offset 12, which is what a real resolver emits — so the decoder's
 * pointer handling is exercised by every fixture here rather than one special case.
 */
function buildResponse(input: {
  id: number;
  rcode?: number;
  question: { name: string; type: number };
  answers?: { type: number; rdata: number[] }[];
  truncated?: boolean;
  omitQuestion?: boolean;
  /** RFC 8914 Extended DNS Error, carried in an EDNS(0) OPT record. */
  ede?: { infoCode: number; text?: string };
  /** Authority records to walk past before the additional section. */
  authority?: number;
}): Uint8Array<ArrayBuffer> {
  const answers = input.answers ?? [];
  const labels = input.question.name.split(".").filter(Boolean);
  const qnameBytes: number[] = [];
  for (const label of labels) {
    qnameBytes.push(label.length, ...[...label].map((c) => c.charCodeAt(0)));
  }
  qnameBytes.push(0);

  const body: number[] = [];
  if (!input.omitQuestion) {
    body.push(...qnameBytes, (input.question.type >> 8) & 0xff, input.question.type & 0xff, 0, 1);
  }
  for (const answer of answers) {
    body.push(0xc0, 0x0c); // pointer to the question name
    body.push((answer.type >> 8) & 0xff, answer.type & 0xff);
    body.push(0, 1); // class IN
    body.push(0, 0, 0, 60); // ttl
    body.push((answer.rdata.length >> 8) & 0xff, answer.rdata.length & 0xff);
    body.push(...answer.rdata);
  }

  // Authority filler, only there to prove the decoder walks past it to the OPT record.
  const authorityCount = input.authority ?? 0;
  for (let i = 0; i < authorityCount; i += 1) {
    body.push(0xc0, 0x0c, 0, 2, 0, 1, 0, 0, 0, 60, 0, 2, 0xc0, 0x0c); // an NS record
  }

  if (input.ede) {
    const text = [...(input.ede.text ?? "")].map((c) => c.charCodeAt(0));
    const optionData = [(input.ede.infoCode >> 8) & 0xff, input.ede.infoCode & 0xff, ...text];
    body.push(0); // OPT owner name is root
    body.push(0, 41); // type OPT
    body.push(0x10, 0x00); // class: udp payload size
    body.push(0, 0, 0, 0); // ttl: extended rcode, version, flags
    const rdLength = 4 + optionData.length;
    body.push((rdLength >> 8) & 0xff, rdLength & 0xff);
    body.push(0, 15); // option code: Extended DNS Error
    body.push((optionData.length >> 8) & 0xff, optionData.length & 0xff);
    body.push(...optionData);
  }

  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint16(0, input.id);
  view.setUint16(2, 0x8180 | (input.truncated ? 0x0200 : 0) | (input.rcode ?? RCODE_NOERROR));
  view.setUint16(4, input.omitQuestion ? 0 : 1);
  view.setUint16(6, answers.length);
  view.setUint16(8, authorityCount);
  view.setUint16(10, input.ede ? 1 : 0);
  out.set(body, 12);
  return out;
}

const V4 = [93, 184, 216, 34];
const V4_SINKHOLE = [0, 0, 0, 0];
const V6 = [0x26, 0x06, 0x28, 0x00, 0x02, 0x20, 0, 1, 2, 0x48, 0x18, 0x93, 0x25, 0xc8, 0x19, 0x46];
const V6_SINKHOLE = new Array(16).fill(0);

describe("dns wire format", () => {
  it("encodes a standard recursive query", () => {
    const query = encodeQuery("example.com", TYPE_A, 0xabcd);
    const view = new DataView(query.buffer);
    expect(view.getUint16(0)).toBe(0xabcd);
    expect(view.getUint16(2)).toBe(0x0100); // RD set, not a response
    expect(view.getUint16(4)).toBe(1); // one question
    expect(view.getUint16(6)).toBe(0); // no answers
    expect(view.getUint16(10)).toBe(1); // one additional: the EDNS(0) OPT record
    // 7example3com0 then qtype + qclass
    expect([...query.slice(12, 25)]).toEqual([
      7, 101, 120, 97, 109, 112, 108, 101, 3, 99, 111, 109, 0,
    ]);
    expect(view.getUint16(25)).toBe(TYPE_A);
    expect(view.getUint16(27)).toBe(1);
  });

  it("round-trips an id so a stale answer can be spotted", () => {
    const decoded = decodeResponse(
      buildResponse({
        id: 0x1234,
        question: { name: "example.com", type: TYPE_A },
        answers: [{ type: TYPE_A, rdata: V4 }],
      }),
    );
    expect(decoded.id).toBe(0x1234);
  });

  it("reads addresses past a compressed answer name", () => {
    const decoded = decodeResponse(
      buildResponse({
        id: 1,
        question: { name: "example.com", type: TYPE_A },
        answers: [{ type: TYPE_A, rdata: V4 }],
      }),
    );
    expect(decoded.rcode).toBe(RCODE_NOERROR);
    expect(decoded.addresses).toEqual([{ type: TYPE_A, address: "93.184.216.34" }]);
  });

  it("skips a CNAME and still finds the address behind it", () => {
    const decoded = decodeResponse(
      buildResponse({
        id: 1,
        question: { name: "www.example.com", type: TYPE_A },
        answers: [
          { type: TYPE_CNAME, rdata: [0xc0, 0x0c] },
          { type: TYPE_A, rdata: V4 },
        ],
      }),
    );
    expect(decoded.addresses).toHaveLength(1);
    expect(decoded.otherAnswerCount).toBe(1);
  });

  it("formats IPv6 uncompressed so an all-zero address is recognisable", () => {
    const real = decodeResponse(
      buildResponse({
        id: 1,
        question: { name: "example.com", type: TYPE_AAAA },
        answers: [{ type: TYPE_AAAA, rdata: V6 }],
      }),
    );
    expect(real.addresses[0]!.address).toBe("2606:2800:220:1:248:1893:25c8:1946");

    const zero = decodeResponse(
      buildResponse({
        id: 1,
        question: { name: "example.com", type: TYPE_AAAA },
        answers: [{ type: TYPE_AAAA, rdata: V6_SINKHOLE }],
      }),
    );
    expect(zero.addresses[0]!.address).toBe("0:0:0:0:0:0:0:0");
  });

  it("reports rcode and the truncation flag", () => {
    const nx = decodeResponse(
      buildResponse({
        id: 1,
        rcode: RCODE_NXDOMAIN,
        question: { name: "gone.example", type: TYPE_A },
      }),
    );
    expect(nx.rcode).toBe(RCODE_NXDOMAIN);
    expect(nx.addresses).toEqual([]);

    const tc = decodeResponse(
      buildResponse({ id: 1, truncated: true, question: { name: "a.example", type: TYPE_A } }),
    );
    expect(tc.truncated).toBe(true);
  });

  it("rejects a body too short to be a header", () => {
    expect(() => decodeResponse(new Uint8Array(4))).toThrow(/shorter than a DNS header/i);
  });

  it("carries an EDNS(0) OPT record on every query", () => {
    const query = encodeQuery("example.com", TYPE_A, 1);
    // root name, type 41, class 4096, ttl 0, rdlength 0
    expect([...query.slice(-11)]).toEqual([0, 0, 41, 0x10, 0x00, 0, 0, 0, 0, 0, 0]);
  });

  it("reads an Extended DNS Error out of the OPT record", () => {
    const decoded = decodeResponse(
      buildResponse({
        id: 1,
        question: { name: "pornhub.com", type: TYPE_A },
        answers: [{ type: TYPE_A, rdata: [149, 248, 211, 216] }],
        ede: { infoCode: 17, text: "Blocked by NextDNS: category:porn~beta" },
      }),
    );
    expect(decoded.extendedError).toEqual({
      infoCode: 17,
      text: "Blocked by NextDNS: category:porn~beta",
    });
  });

  it("finds the OPT record past authority records", () => {
    const decoded = decodeResponse(
      buildResponse({
        id: 1,
        question: { name: "x.example", type: TYPE_A },
        authority: 2,
        ede: { infoCode: 15, text: "" },
      }),
    );
    expect(decoded.extendedError?.infoCode).toBe(15);
  });

  it("reports no extended error when the resolver sent none", () => {
    const decoded = decodeResponse(
      buildResponse({
        id: 1,
        question: { name: "example.com", type: TYPE_A },
        answers: [{ type: TYPE_A, rdata: V4 }],
      }),
    );
    expect(decoded.extendedError).toBeNull();
  });

  it("rejects an answer count larger than the body", () => {
    const short = buildResponse({ id: 1, question: { name: "a.example", type: TYPE_A } });
    new DataView(short.buffer).setUint16(6, 5); // claim five answers that are not there
    expect(() => decodeResponse(short)).toThrow(/resource record/i);
  });
});

describe("blocked-response predicate", () => {
  function response(rcode: number, answers: { type: number; rdata: number[] }[] = []) {
    return decodeResponse(
      buildResponse({ id: 1, rcode, question: { name: "x.example", type: TYPE_A }, answers }),
    );
  }

  it("reads NXDOMAIN as blocked", () => {
    expect(isBlockedResponse(response(RCODE_NXDOMAIN))).toBe(true);
  });

  it("reads a sinkhole address as blocked", () => {
    expect(isBlockedResponse(response(RCODE_NOERROR, [{ type: TYPE_A, rdata: V4_SINKHOLE }]))).toBe(true);
    expect(
      isBlockedResponse(response(RCODE_NOERROR, [{ type: TYPE_AAAA, rdata: V6_SINKHOLE }])),
    ).toBe(true);
  });

  it("reads NODATA as blocked, including a CNAME leading nowhere", () => {
    expect(isBlockedResponse(response(RCODE_NOERROR))).toBe(true);
    expect(isBlockedResponse(response(RCODE_NOERROR, [{ type: TYPE_CNAME, rdata: [0xc0, 0x0c] }]))).toBe(
      true,
    );
  });

  /**
   * The shape a real NextDNS profile returns for a blocked name: NOERROR, and a
   * routable address — its block page — so every heuristic below says "fine". Only
   * the EDE says otherwise. Captured from dns.nextdns.io against a live profile.
   */
  it("reads a routable address with a Filtered EDE as blocked", () => {
    const nextdns = decodeResponse(
      buildResponse({
        id: 1,
        question: { name: "pornhub.com", type: TYPE_A },
        answers: [{ type: TYPE_A, rdata: [149, 248, 211, 216] }],
        ede: { infoCode: 17, text: "Blocked by NextDNS: category:porn~beta" },
      }),
    );
    expect(nextdns.rcode).toBe(RCODE_NOERROR);
    expect(nextdns.addresses).toHaveLength(1);
    expect(isBlockedResponse(nextdns)).toBe(true);
  });

  /**
   * The control, captured from unfiltered Cloudflare (1.1.1.1) for the same name that
   * NextDNS blocks. Both are NOERROR with a routable address; only the EDE differs.
   * Nothing may classify by address, or these two become indistinguishable.
   */
  it("reads the same name from an unfiltered resolver as not blocked", () => {
    const cloudflare = decodeResponse(
      buildResponse({
        id: 1,
        question: { name: "pornhub.com", type: TYPE_A },
        answers: [{ type: TYPE_A, rdata: [66, 254, 114, 41] }],
      }),
    );
    expect(cloudflare.rcode).toBe(RCODE_NOERROR);
    expect(cloudflare.extendedError).toBeNull();
    expect(isBlockedResponse(cloudflare)).toBe(false);
  });

  /**
   * Cloudflare for Families (1.1.1.3), measured live: it sinkholes *and* sends the
   * EDE, so either branch alone would catch it. Kept because it is the shape that
   * proves the two signals agree rather than compete.
   */
  it("reads a sinkhole carrying an EDE as blocked", () => {
    const family = decodeResponse(
      buildResponse({
        id: 1,
        question: { name: "pornhub.com", type: TYPE_A },
        answers: [{ type: TYPE_A, rdata: V4_SINKHOLE }],
        ede: { infoCode: 17, text: "Filtered" },
      }),
    );
    expect(isBlockedResponse(family)).toBe(true);
    expect(family.addresses[0]!.address).toBe("0.0.0.0");
    expect(family.extendedError?.infoCode).toBe(17);
  });

  /** A resolver that sinkholes without an EDE is still caught — Pi-hole, AdGuard Home. */
  it("reads a sinkhole with no EDE as blocked", () => {
    const sinkholeOnly = decodeResponse(
      buildResponse({
        id: 1,
        question: { name: "pornhub.com", type: TYPE_A },
        answers: [{ type: TYPE_A, rdata: V4_SINKHOLE }],
      }),
    );
    expect(sinkholeOnly.extendedError).toBeNull();
    expect(isBlockedResponse(sinkholeOnly)).toBe(true);
  });

  it("treats Blocked and Censored as filtered too, but not Prohibited", () => {
    const withCode = (infoCode: number) =>
      decodeResponse(
        buildResponse({
          id: 1,
          question: { name: "x.example", type: TYPE_A },
          answers: [{ type: TYPE_A, rdata: V4 }],
          ede: { infoCode, text: "" },
        }),
      );
    expect(isBlockedResponse(withCode(15))).toBe(true); // Blocked
    expect(isBlockedResponse(withCode(16))).toBe(true); // Censored
    expect(isBlockedResponse(withCode(17))).toBe(true); // Filtered
    // Prohibited says the client may not ask at all — not a verdict about this name.
    expect(() => isBlockedResponse(withCode(18))).toThrow(/prohibited/i);
    // An informational EDE on an ordinary answer must not read as a block.
    expect(isBlockedResponse(withCode(0))).toBe(false);
  });

  it("reads a routable address as not blocked", () => {
    expect(isBlockedResponse(response(RCODE_NOERROR, [{ type: TYPE_A, rdata: V4 }]))).toBe(false);
    expect(isBlockedResponse(response(RCODE_NOERROR, [{ type: TYPE_AAAA, rdata: V6 }]))).toBe(false);
  });

  it("treats a mix of sinkhole and routable as not blocked", () => {
    expect(
      isBlockedResponse(
        response(RCODE_NOERROR, [
          { type: TYPE_A, rdata: V4_SINKHOLE },
          { type: TYPE_A, rdata: V4 },
        ]),
      ),
    ).toBe(false);
  });
});

describe("failed DNS observations", () => {
  it.each([
    { name: "SERVFAIL", rcode: 2 },
    { name: "REFUSED", rcode: 5 },
    { name: "truncated answer", truncated: true },
    { name: "prohibited", rcode: 5, ede: { infoCode: 18 } },
    { name: "missing answer body", missing: true },
  ])("keeps $name unknown through category rollup", async (shape) => {
    const resolve = dohResolver({
      resolverUrl: "https://dns.example/query",
      timeoutMs: 1000,
      fetchImpl: (async (_url, init) => {
        const query = new Uint8Array(init!.body as ArrayBuffer);
        const bytes = buildResponse({
          ...shape,
          id: new DataView(query.buffer).getUint16(0),
          question: { name: "example.com", type: TYPE_A },
        });
        if ("missing" in shape) new DataView(bytes.buffer).setUint16(6, 1);
        return new Response(bytes);
      }) as typeof fetch,
    });
    const result = await resolve("example.com");
    expect(result.blocked).toBeNull();
    expect(result.error).toBeTruthy();
    expect(rollUpVerdict([result]).verdict).toBe("unknown");
  });

  it("still honors an explicit filtering EDE on a refused query", () => {
    const response = decodeResponse(buildResponse({
      id: 1, rcode: 5, question: { name: "example.com", type: TYPE_A },
      ede: { infoCode: 17 },
    }));
    expect(isBlockedResponse(response)).toBe(true);
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

  it("is partial when some are blocked and open when none are", () => {
    expect(rollUpVerdict([probe("a", true), probe("b", false)]).verdict).toBe(UpstreamVerdict.partial);
    expect(rollUpVerdict([probe("a", false), probe("b", false)]).verdict).toBe(UpstreamVerdict.open);
  });

  /** One unobserved domain must not be laundered into "not blocked". */
  it("is unknown when any domain could not be observed", () => {
    expect(rollUpVerdict([probe("a", false), probe("b", null)]).verdict).toBe(UpstreamVerdict.unknown);
    const all = rollUpVerdict([probe("a", true), probe("b", true), probe("c", null)]);
    expect(all.verdict).toBe(UpstreamVerdict.unknown);
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
  function reply(body: Uint8Array<ArrayBuffer>, status = 200): Response {
    return new Response(body, { status, headers: { "content-type": DNS_MESSAGE_MEDIA_TYPE } });
  }

  /** Answers from the query it is given, echoing the id as a real resolver does. */
  function resolverFor(answer: (domain: string, type: number) => { rcode?: number; rdata?: number[] }) {
    const calls: { domain: string; type: number }[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const query = new Uint8Array(init!.body as ArrayBuffer);
      const view = new DataView(query.buffer);
      const id = view.getUint16(0);
      // Recover the queried name, then read qtype from just past it. Not from the end
      // of the buffer: an EDNS(0) OPT record now follows the question.
      const labels: string[] = [];
      let offset = 12;
      while (query[offset] !== 0) {
        const length = query[offset]!;
        labels.push(String.fromCharCode(...query.slice(offset + 1, offset + 1 + length)));
        offset += 1 + length;
      }
      const type = view.getUint16(offset + 1);
      const domain = labels.join(".");
      calls.push({ domain, type });
      const { rcode, rdata } = answer(domain, type);
      return reply(
        buildResponse({
          id,
          rcode: rcode ?? RCODE_NOERROR,
          question: { name: domain, type },
          answers: rdata ? [{ type, rdata }] : [],
        }),
      );
    });
    return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
  }

  it("POSTs dns-message to the endpoint exactly as configured", async () => {
    const seen: { url: string; headers: Headers; method?: string }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), headers: new Headers(init?.headers), method: init?.method });
      return reply(
        buildResponse({
          id: new DataView(new Uint8Array(init!.body as ArrayBuffer).buffer).getUint16(0),
          question: { name: "example.com", type: TYPE_A },
          answers: [{ type: TYPE_A, rdata: V4 }],
        }),
      );
    });
    const resolve = dohResolver({
      resolverUrl: "https://dns.example.com/dns-query/profile",
      timeoutMs: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await resolve("example.com");
    expect(result.blocked).toBe(false);
    expect(seen[0]!.method).toBe("POST");
    // The endpoint is used verbatim — no query string appended, path preserved.
    expect(seen[0]!.url).toBe("https://dns.example.com/dns-query/profile");
    expect(seen[0]!.headers.get("content-type")).toBe(DNS_MESSAGE_MEDIA_TYPE);
    expect(seen[0]!.headers.get("accept")).toBe(DNS_MESSAGE_MEDIA_TYPE);
  });

  it("reports a sinkholed name as blocked", async () => {
    const { fetchImpl } = resolverFor(() => ({ rdata: V4_SINKHOLE }));
    const resolve = dohResolver({ resolverUrl: "https://d.example/q", timeoutMs: 1000, fetchImpl });
    const result = await resolve("pornhub.com");
    expect(result.blocked).toBe(true);
  });

  /**
   * A name with no A record but a real AAAA record is reachable, so it must not be
   * read as filtered just because the A query came back empty.
   */
  it("falls through to AAAA before calling NODATA a block", async () => {
    const { fetchImpl, calls } = resolverFor((_domain, type) =>
      type === TYPE_AAAA ? { rdata: V6 } : {},
    );
    const resolve = dohResolver({ resolverUrl: "https://d.example/q", timeoutMs: 1000, fetchImpl });

    const result = await resolve("v6only.example");

    expect(calls.map((call) => call.type)).toEqual([TYPE_A, TYPE_AAAA]);
    expect(result.blocked).toBe(false);
    expect(result.answers).toContain("2606:2800:220:1:248:1893:25c8:1946");
  });

  it("does not ask for AAAA when NXDOMAIN already covers the whole name", async () => {
    const { fetchImpl, calls } = resolverFor(() => ({ rcode: RCODE_NXDOMAIN }));
    const resolve = dohResolver({ resolverUrl: "https://d.example/q", timeoutMs: 1000, fetchImpl });

    const result = await resolve("gone.example");

    expect(result.blocked).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("returns blocked null on a non-2xx, a throw and a mismatched id", async () => {
    const http500 = dohResolver({
      resolverUrl: "https://d.example/q",
      timeoutMs: 1000,
      fetchImpl: (async () => reply(new Uint8Array(12), 500)) as unknown as typeof fetch,
    });
    const failed = await http500("example.com");
    expect(failed.blocked).toBeNull();
    expect(failed.error).toBe("HTTP 500");

    const thrown = dohResolver({
      resolverUrl: "https://d.example/q",
      timeoutMs: 1000,
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    expect((await thrown("example.com")).blocked).toBeNull();

    const wrongId = dohResolver({
      resolverUrl: "https://d.example/q",
      timeoutMs: 1000,
      fetchImpl: (async () =>
        reply(
          buildResponse({
            id: 0x9999,
            question: { name: "example.com", type: TYPE_A },
            answers: [{ type: TYPE_A, rdata: V4 }],
          }),
        )) as unknown as typeof fetch,
    });
    const stale = await wrongId("example.com");
    expect(stale.blocked).toBeNull();
    expect(stale.error).toMatch(/id did not match/i);
  });

  it("caps requests in flight and keeps input order", async () => {
    let inFlight = 0;
    let peak = 0;
    const resolve = async (domain: string): Promise<DomainProbe> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((done) => setTimeout(done, 5));
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
