#!/usr/bin/env node
/**
 * Which transports does a DoH endpoint actually serve?
 *
 * RFC 8484 standardises `application/dns-message` (wire format) over both GET
 * (`?dns=<base64url>`) and POST. The `application/dns-json` API is a separate
 * de facto convention that some providers also serve. This asks each endpoint
 * directly rather than trusting documentation.
 *
 *   node scripts/doh-probe.mjs
 *   node scripts/doh-probe.mjs https://dns.nextdns.io/<profile>/FamilyFi
 *
 * Any extra arguments are treated as additional endpoints to test, which is how
 * you check your own resolver or a profile URL.
 */

const TYPE_A = 1;

/**
 * `json` is listed separately where a provider serves its JSON API off a different
 * path — Google uses /resolve. That inconsistency is itself an argument for the wire
 * format, whose path is the one RFC 8484 specifies.
 */
const DEFAULT_ENDPOINTS = [
  { name: "Cloudflare", wire: "https://cloudflare-dns.com/dns-query" },
  // 1.1.1.3 — Cloudflare for Families, malware + adult. Expected to sinkhole rather
  // than send an EDE, which is the other branch of the predicate.
  { name: "Cloudflare Family", wire: "https://family.cloudflare-dns.com/dns-query" },
  { name: "Google", wire: "https://dns.google/dns-query", json: "https://dns.google/resolve" },
  { name: "Quad9", wire: "https://dns.quad9.net/dns-query" },
  // Public NextDNS endpoint. A household profile is https://dns.nextdns.io/<id>/<name>.
  { name: "NextDNS", wire: "https://dns.nextdns.io" },
  { name: "AdGuard", wire: "https://dns.adguard-dns.com/dns-query" },
];

/** Probe names: one that should resolve, one that a filtering resolver should block. */
const CONTROL = "example.com";
const FILTERED = "pornhub.com";

/**
 * Carries an EDNS(0) OPT record, without which no Extended DNS Error comes back — and
 * the EDE is how several providers say "I filtered this" while still answering with a
 * routable address. Mirrors src/server/upstream/dns-message.ts.
 */
function encodeQuery(domain, type, id) {
  const labels = domain.split(".").filter(Boolean);
  const nameLength = labels.reduce((t, l) => t + 1 + l.length, 0) + 1;
  const buf = new Uint8Array(12 + nameLength + 4 + 11);
  const view = new DataView(buf.buffer);
  view.setUint16(0, id & 0xffff);
  view.setUint16(2, 0x0100);
  view.setUint16(4, 1);
  view.setUint16(10, 1); // one additional: the OPT record
  let o = 12;
  for (const l of labels) {
    buf[o++] = l.length;
    for (let i = 0; i < l.length; i += 1) buf[o++] = l.charCodeAt(i);
  }
  buf[o++] = 0;
  view.setUint16(o, type);
  view.setUint16(o + 2, 1);
  o += 4;
  buf[o++] = 0; // OPT owner name is root
  view.setUint16(o, 41); // type OPT
  view.setUint16(o + 2, 4096); // udp payload size
  view.setUint32(o + 4, 0);
  view.setUint16(o + 8, 0);
  return buf;
}

function skipName(bytes, start) {
  let o = start;
  for (;;) {
    const len = bytes[o];
    if (len === 0) return o + 1;
    if ((len & 0xc0) === 0xc0) return o + 2;
    o += 1 + len;
  }
}

function decodeResponse(msg) {
  const view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
  const rcode = view.getUint16(2) & 0x000f;
  const counts = [view.getUint16(6), view.getUint16(8), view.getUint16(10)];
  let o = 12;
  for (let i = 0, qd = view.getUint16(4); i < qd; i += 1) {
    o = skipName(msg, o);
    o += 4;
  }
  const addresses = [];
  let ede = null;
  counts.forEach((count, section) => {
    for (let i = 0; i < count; i += 1) {
      if (o >= msg.length) return;
      o = skipName(msg, o);
      if (o + 10 > msg.length) return;
      const type = view.getUint16(o);
      const rdLen = view.getUint16(o + 8);
      const rd = o + 10;
      if (section === 0 && type === TYPE_A && rdLen === 4) {
        addresses.push(`${msg[rd]}.${msg[rd + 1]}.${msg[rd + 2]}.${msg[rd + 3]}`);
      } else if (type === 41 && !ede) {
        let p = rd;
        while (p + 4 <= rd + rdLen) {
          const code = view.getUint16(p);
          const len = view.getUint16(p + 2);
          if (code === 15 && len >= 2) {
            ede = {
              infoCode: view.getUint16(p + 4),
              text: new TextDecoder().decode(msg.subarray(p + 6, p + 4 + len)),
            };
            break;
          }
          p += 4 + len;
        }
      }
      o = rd + rdLen;
    }
  });
  return { rcode, addresses, ede };
}

const base64url = (bytes) =>
  Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** EDE first, because that is what decides a verdict when the answer looks ordinary. */
function describe(decoded, contentType) {
  const ede = decoded.ede ? ` EDE=${decoded.ede.infoCode} "${decoded.ede.text}"` : " EDE=none";
  return `rcode=${decoded.rcode}${ede} answers=[${decoded.addresses.join(",")}] ct=${contentType}`;
}

async function attempt(label, run) {
  try {
    const result = await run();
    return { label, ok: true, ...result };
  } catch (error) {
    return { label, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function wirePost(url, domain) {
  const body = encodeQuery(domain, TYPE_A, 0x1234);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/dns-message", accept: "application/dns-message" },
    body,
    signal: AbortSignal.timeout(8000),
  });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok) throw new Error(`HTTP ${res.status} (${type})`);
  const decoded = decodeResponse(new Uint8Array(await res.arrayBuffer()));
  return { detail: describe(decoded, type) };
}

async function wireGet(url, domain) {
  const q = base64url(encodeQuery(domain, TYPE_A, 0x1234));
  const target = `${url}${url.includes("?") ? "&" : "?"}dns=${q}`;
  const res = await fetch(target, {
    headers: { accept: "application/dns-message" },
    signal: AbortSignal.timeout(8000),
  });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok) throw new Error(`HTTP ${res.status} (${type})`);
  const decoded = decodeResponse(new Uint8Array(await res.arrayBuffer()));
  return { detail: describe(decoded, type) };
}

async function json(url, domain) {
  const target = `${url}${url.includes("?") ? "&" : "?"}name=${domain}&type=A`;
  const res = await fetch(target, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(8000),
  });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok) throw new Error(`HTTP ${res.status} (${type})`);
  const text = await res.text();
  if (!type.includes("json")) throw new Error(`not json (${type})`);
  const body = JSON.parse(text);
  const answers = (body.Answer ?? []).filter((a) => a.type === TYPE_A).map((a) => a.data);
  return { detail: `Status=${body.Status} answers=[${answers.join(",")}] ct=${type}` };
}

const extra = process.argv.slice(2).map((url, i) => ({ name: `Custom ${i + 1}`, wire: url }));
const endpoints = [...DEFAULT_ENDPOINTS, ...extra];

console.log(`Probing ${endpoints.length} endpoints. Control name: ${CONTROL}\n`);

for (const endpoint of endpoints) {
  console.log(`${endpoint.name}  ${endpoint.wire}`);
  for (const [label, run, url] of [
    ["wire POST", wirePost, endpoint.wire],
    ["wire GET ", wireGet, endpoint.wire],
    ["json GET ", json, endpoint.json ?? endpoint.wire],
  ]) {
    const result = await attempt(label, () => run(url, CONTROL));
    console.log(`  ${result.label}  ${result.ok ? "OK  " : "FAIL"}  ${result.detail ?? ""}`);
  }
  // Does this endpoint filter, and how does it say so?
  const filtered = await attempt("filtered ", () => wirePost(endpoint.wire, FILTERED));
  console.log(`  ${FILTERED} via wire POST  ${filtered.ok ? "OK  " : "FAIL"}  ${filtered.detail ?? ""}`);
  console.log();
}
