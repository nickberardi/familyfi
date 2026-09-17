/**
 * Minimal DNS wire-format encode/decode for the DoH probe (RFC 1035 messages as
 * carried by RFC 8484).
 *
 * RFC 8484 standardises `application/dns-message`, so every conforming resolver
 * speaks it. The `application/dns-json` API that Google originated and Cloudflare,
 * NextDNS and Quad9 also serve is a de facto convention, not part of the RFC — using
 * it would have quietly limited us to those providers and left the response shape a
 * per-provider guess. Wire format removes the guess.
 *
 * Only what the probe needs: one question for A or AAAA, and the response's rcode
 * plus its address records.
 */

export const TYPE_A = 1;
export const TYPE_AAAA = 28;

export const RCODE_NOERROR = 0;
export const RCODE_NXDOMAIN = 3;

export type DnsAddress = { type: number; address: string };

export type DnsResponse = {
  id: number;
  rcode: number;
  /** Truncated. Not expected over DoH, which has no 512-byte datagram limit. */
  truncated: boolean;
  addresses: DnsAddress[];
  /** Answer records that were not A/AAAA — a CNAME chain with no address, typically. */
  otherAnswerCount: number;
};

export class DnsMessageError extends Error {}

/**
 * A standard recursive query. `id` is caller-supplied so the response can be matched.
 *
 * Returns `Uint8Array<ArrayBuffer>` rather than plain `Uint8Array`: `fetch`'s `BodyInit`
 * will not accept the `ArrayBufferLike` form that the bare type widens to.
 */
export function encodeQuery(domain: string, type: number, id: number): Uint8Array<ArrayBuffer> {
  const labels = domain.split(".").filter(Boolean);
  for (const label of labels) {
    if (label.length > 63) throw new DnsMessageError(`Label too long in "${domain}".`);
  }
  const nameLength = labels.reduce((total, label) => total + 1 + label.length, 0) + 1;
  const buffer = new Uint8Array(12 + nameLength + 4);
  const view = new DataView(buffer.buffer);

  view.setUint16(0, id & 0xffff);
  view.setUint16(2, 0x0100); // QR=0, standard query, RD=1
  view.setUint16(4, 1); // one question
  // ancount / nscount / arcount stay zero.

  let offset = 12;
  for (const label of labels) {
    buffer[offset++] = label.length;
    for (let i = 0; i < label.length; i += 1) {
      const code = label.charCodeAt(i);
      if (code > 0x7f) throw new DnsMessageError("Non-ASCII domain; punycode it first.");
      buffer[offset++] = code;
    }
  }
  buffer[offset++] = 0; // root label
  view.setUint16(offset, type);
  view.setUint16(offset + 2, 1); // IN
  return buffer;
}

/**
 * Walks a name and returns the offset just past it. A name is a run of
 * length-prefixed labels ending in a zero byte, or a two-byte pointer to a name
 * earlier in the message (RFC 1035 §4.1.4). A pointer terminates the name, so this
 * only needs to step over it — the probe never reads the name back.
 */
function skipName(bytes: Uint8Array, start: number): number {
  let offset = start;
  for (;;) {
    if (offset >= bytes.length) throw new DnsMessageError("Truncated name.");
    const length = bytes[offset]!;
    if (length === 0) return offset + 1;
    if ((length & 0xc0) === 0xc0) {
      if (offset + 1 >= bytes.length) throw new DnsMessageError("Truncated name pointer.");
      return offset + 2;
    }
    if ((length & 0xc0) !== 0) throw new DnsMessageError("Unknown label type.");
    offset += 1 + length;
  }
}

function formatIpv4(bytes: Uint8Array, offset: number): string {
  return `${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}.${bytes[offset + 3]}`;
}

/** Uncompressed lowercase hex groups, so an all-zero address is always `0:0:0:0:0:0:0:0`. */
function formatIpv6(bytes: Uint8Array, offset: number): string {
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) {
    groups.push(((bytes[offset + i]! << 8) | bytes[offset + i + 1]!).toString(16));
  }
  return groups.join(":");
}

export function decodeResponse(message: Uint8Array): DnsResponse {
  if (message.length < 12) throw new DnsMessageError("Response shorter than a DNS header.");
  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
  const id = view.getUint16(0);
  const flags = view.getUint16(2);
  const rcode = flags & 0x000f;
  const truncated = (flags & 0x0200) !== 0;
  const questionCount = view.getUint16(4);
  const answerCount = view.getUint16(6);

  let offset = 12;
  for (let i = 0; i < questionCount; i += 1) {
    offset = skipName(message, offset);
    offset += 4; // qtype + qclass
  }

  const addresses: DnsAddress[] = [];
  let otherAnswerCount = 0;
  for (let i = 0; i < answerCount; i += 1) {
    if (offset >= message.length) break; // Tolerate a short body rather than throwing.
    offset = skipName(message, offset);
    if (offset + 10 > message.length) break;
    const type = view.getUint16(offset);
    const rdLength = view.getUint16(offset + 8);
    const rdStart = offset + 10;
    if (rdStart + rdLength > message.length) break;
    if (type === TYPE_A && rdLength === 4) {
      addresses.push({ type, address: formatIpv4(message, rdStart) });
    } else if (type === TYPE_AAAA && rdLength === 16) {
      addresses.push({ type, address: formatIpv6(message, rdStart) });
    } else {
      otherAnswerCount += 1;
    }
    offset = rdStart + rdLength;
  }

  return { id, rcode, truncated, addresses, otherAnswerCount };
}
