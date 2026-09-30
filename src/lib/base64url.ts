/**
 * base64url (RFC 4648 §5) without `Buffer` or `atob`, so it runs the same in the browser, on the
 * server and in the native app's JavaScript engine. Encoding never pads; decoding accepts padding.
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const LOOKUP = new Map([...ALPHABET].map((char, index) => [char, index]));

export function base64UrlEncode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const chunk = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = i + 1 >= bytes.length ? 2 : i + 2 >= bytes.length ? 3 : 4;
    for (let j = 0; j < chars; j++) out += ALPHABET[(chunk >> (18 - 6 * j)) & 63];
  }
  return out;
}

/**
 * The bytes of a base64url string, with or without `=` padding, or null when it is not base64url.
 * Plain base64's `+` and `/` are refused, so a value mangled on the way reads as invalid rather than
 * as some other value.
 */
export function base64UrlDecode(value: string): Uint8Array | null {
  const unpadded = value.replace(/=+$/, "");
  if (unpadded.length % 4 === 1) return null;
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of unpadded) {
    const index = LOOKUP.get(char);
    if (index === undefined) return null;
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

export function utf8Encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function utf8Decode(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
