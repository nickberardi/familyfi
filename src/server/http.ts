import { BlockList, isIP } from "node:net";
import { NextResponse } from "next/server";
import { ConfigurationError } from "./env";

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
  };
};

export function jsonError(status: number, code: string, message: string): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function jsonCaughtError(error: unknown): NextResponse<ApiErrorBody> {
  console.error(error);
  if (error instanceof ConfigurationError) {
    return jsonError(
      503,
      "misconfigured",
      `FamilyFi is missing required settings in .env. ${error.message} Fix .env and restart the server.`,
    );
  }
  if (error && typeof error === "object" && "name" in error && error.name === "SchemaMismatchError") {
    return jsonError(
      500,
      "schema_mismatch",
      error instanceof Error
        ? error.message
        : "The running app is using an old database client. Restart FamilyFi after applying migrations.",
    );
  }
  if (error && typeof error === "object" && "name" in error && error.name === "PrismaClientValidationError") {
    return jsonError(
      500,
      "schema_mismatch",
      "The running app is using an old database client. Restart FamilyFi after applying migrations.",
    );
  }
  return jsonError(500, "internal", "Something went wrong. Check the FamilyFi server log.");
}

const LOOPBACK = ["127.0.0.0/8", "::1/128"];

let trustedCache: { value: string; list: BlockList } | undefined;

/**
 * Loopback, and the proxies named in `FAMILYFI_TRUSTED_PROXIES` (addresses or CIDRs, separated by
 * commas or spaces). An entry that is neither is left out, so a typo trusts less, never more.
 */
export function trustedProxies(value = process.env.FAMILYFI_TRUSTED_PROXIES ?? ""): BlockList {
  if (trustedCache?.value === value) return trustedCache.list;
  const list = new BlockList();
  const ignored: string[] = [];
  for (const entry of [...LOOPBACK, ...value.split(/[\s,]+/).filter(Boolean)]) {
    const range = subnet(entry);
    if (range) list.addSubnet(...range);
    else ignored.push(entry);
  }
  if (ignored.length) console.warn(`FAMILYFI_TRUSTED_PROXIES: ignoring ${ignored.join(", ")}; each entry is an address or a CIDR.`);
  trustedCache = { value, list };
  return list;
}

function subnet(entry: string): [string, number, "ipv4" | "ipv6"] | undefined {
  const match = /^([^/]+)(?:\/(\d{1,3}))?$/.exec(entry);
  const address = match && plainAddress(match[1]);
  if (!address) return undefined;
  const type = addressType(address);
  const max = type === "ipv6" ? 128 : 32;
  const bits = match[2] === undefined ? max : Number(match[2]);
  return bits <= max ? [address, bits, type] : undefined;
}

function addressType(address: string): "ipv4" | "ipv6" {
  return isIP(address) === 6 ? "ipv6" : "ipv4";
}

/** An IP address as written in X-Forwarded-For, IPv4-mapped IPv6 as plain IPv4; anything else is undefined. */
function plainAddress(value: string): string | undefined {
  let address = value.trim().replace(/^\[(.*)\]$/, "$1");
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(address)) address = address.slice(7);
  return isIP(address) ? address : undefined;
}

/**
 * The address a request came from, for the sign-in throttle. FamilyFi's server appends the address
 * that connected to X-Forwarded-For (scripts/runtime/forwarded-for.mjs), so the last entry is one
 * nobody can forge. Walking from the right, each entry is believed only while the hop that added it
 * is trusted (`trustedProxies`); the first address from an untrusted hop is the client. A malformed
 * entry stops the walk at the last trusted hop.
 */
export function clientIp(request: Request, trusted: BlockList = trustedProxies()): string {
  const hops = (request.headers.get("x-forwarded-for") ?? "").split(",");
  let client = "unknown";
  for (let i = hops.length - 1; i >= 0; i -= 1) {
    const address = plainAddress(hops[i]);
    if (!address) break;
    client = address;
    if (!trusted.check(address, addressType(address))) break;
  }
  return client;
}
