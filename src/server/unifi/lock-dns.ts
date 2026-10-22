import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { encryptedDnsAddresses, encryptedDnsHosts } from "@/lib/encrypted-dns";
import { unifiMockEnabled } from "../env";
import type { NetworkDetails } from "./types";

/**
 * The household's own DNS, which Lock DNS leaves alone: the servers its networks hand out
 * by DHCP, and the resolvers set in FamilyFi with the addresses they resolve to. A family
 * that points its devices at a public filter, like Cloudflare for Families, keeps it.
 */
export type LockDnsExemptions = { addresses: string[]; hosts: string[] };

export const NO_EXEMPTIONS: LockDnsExemptions = { addresses: [], hosts: [] };

/** What Lock DNS blocks once the household's own DNS is left out. */
export type LockDnsTargets = {
  /** Port 53 and 853 stay open to these; everything else on those ports is blocked. */
  allowed: string[];
  ipv4: string[];
  ipv6: string[];
  hosts: string[];
};

/** A service address or subnet holding an exempt address is left out whole. */
function holds(entry: string, address: string): boolean {
  const version = isIP(address);
  const [base, bits] = entry.split("/");
  if (!version || isIP(base!) !== version) return false;
  const type = version === 4 ? "ipv4" : "ipv6";
  const list = new BlockList();
  if (bits === undefined) list.addAddress(base!, type);
  else list.addSubnet(base!, Number(bits), type);
  return list.check(address, type);
}

export function lockDnsTargets(exempt: LockDnsExemptions = NO_EXEMPTIONS): LockDnsTargets {
  const kept = (entry: string) => !exempt.addresses.some((address) => holds(entry, address));
  return {
    allowed: [...new Set(exempt.addresses.filter((address) => isIP(address)))].sort(),
    ipv4: encryptedDnsAddresses("ipv4").filter(kept),
    ipv6: encryptedDnsAddresses("ipv6").filter(kept),
    // Blocking a name blocks its subdomains, so a resolver's parent name stays open too.
    hosts: encryptedDnsHosts().filter((host) => !exempt.hosts.some((own) => own === host || own.endsWith(`.${host}`))),
  };
}

type Resolve = (host: string) => Promise<string[]>;

const RESOLVE_TIMEOUT_MS = 2_000;
const RESOLVE_TTL_MS = 60 * 60_000;
const resolved = new Map<string, { at: number; addresses: string[] }>();

const systemResolve: Resolve = async (host) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), RESOLVE_TIMEOUT_MS);
  });
  try {
    const answers = await Promise.race([lookup(host, { all: true }), timeout]);
    return answers.map((answer) => answer.address);
  } finally {
    clearTimeout(timer);
  }
};

let testResolve: Resolve | undefined;

/** Tests answer host lookups themselves; undefined restores the default. */
export function setLockDnsResolverForTests(resolve: Resolve | undefined) {
  testResolve = resolve;
  resolved.clear();
}

/** The UniFi mock enforces nothing, so its household never looks a resolver up. */
const resolveHost: Resolve = (host) => (testResolve ?? (unifiMockEnabled() ? async () => [] : systemResolve))(host);

/** A resolver's addresses, remembered for an hour; none when it cannot be looked up. */
async function addressesOf(host: string): Promise<string[]> {
  const cached = resolved.get(host);
  if (cached && Date.now() - cached.at < RESOLVE_TTL_MS) return cached.addresses;
  try {
    const addresses = [...new Set(await resolveHost(host))].filter((address) => isIP(address)).sort();
    resolved.set(host, { at: Date.now(), addresses });
    return addresses;
  } catch {
    // The last answer stands; with none, its name stays open and the next pass looks again.
    return cached?.addresses ?? [];
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * The household's own DNS, from the managed networks' DHCP settings and the resolvers set in
 * FamilyFi; null while a gateway network's details could not be read this pass, since planning
 * without its servers would block them.
 */
export async function lockDnsExemptions(input: {
  networks: Pick<NetworkDetails, "enabled" | "detailsUnread" | "ipv4Configuration">[];
  resolverUrls: (string | null)[];
}): Promise<LockDnsExemptions | null> {
  if (input.networks.some((network) => network.enabled && network.detailsUnread)) return null;
  // A server on one of the household's own networks, like a Pi-hole, is never on the internet to block.
  const local = new BlockList();
  for (const network of input.networks) {
    const ipv4 = network.ipv4Configuration;
    if (ipv4 && isIP(ipv4.hostIpAddress) === 4) local.addSubnet(ipv4.hostIpAddress, ipv4.prefixLength, "ipv4");
  }
  // Only a network's own DHCP server hands these out, as upstream discovery reads them.
  const addresses = input.networks
    .filter((network) => network.enabled && network.ipv4Configuration?.dhcpConfiguration?.mode === "SERVER")
    .flatMap((network) => network.ipv4Configuration?.dhcpConfiguration?.dnsServerIpAddressesOverride ?? [])
    .filter((address) => isIP(address) && !local.check(address, isIP(address) === 4 ? "ipv4" : "ipv6"));
  const hosts: string[] = [];
  for (const host of new Set(input.resolverUrls.flatMap((url) => (url ? [hostOf(url)] : [])))) {
    if (!host) continue;
    if (isIP(host)) {
      addresses.push(host);
      continue;
    }
    hosts.push(host);
    addresses.push(...(await addressesOf(host)));
  }
  return { addresses: [...new Set(addresses.filter((address) => isIP(address)))].sort(), hosts: hosts.sort() };
}
