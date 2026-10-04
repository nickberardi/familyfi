import { isIP } from "node:net";
import { prisma } from "../db";
import { clientForHousehold } from "../unifi/connection";
import { networkInScope } from "../unifi/scope";
import { loadNetworkDetails } from "../unifi/networks";
import { withUpstreamLock } from "./transaction";

export type ResolverNetwork = {
  id: string;
  name: string;
  servers: string[];
  reason: string | null;
};

export type ResolverContext = {
  source: "doh" | "dhcp" | "unknown";
  url: string | null;
  networks: ResolverNetwork[];
  reason: string | null;
};

type Network = {
  id: string;
  name: string;
  enabled: boolean;
  ipv4Configuration?: {
    hostIpAddress: string;
    dhcpConfiguration?: {
      mode: string;
      dnsServerIpAddressesOverride?: string[] | null;
    } | null;
  };
};

/** DHCP settings describe what UniFi hands to clients; missing detail is not a guess. */
export function discoveredNetwork(network: Network): ResolverNetwork {
  const dhcp = network.ipv4Configuration?.dhcpConfiguration;
  if (!network.enabled) return { id: network.id, name: network.name, servers: [], reason: "Network is disabled." };
  if (!dhcp) return { id: network.id, name: network.name, servers: [], reason: "No DHCP server configuration is available." };
  if (dhcp.mode !== "SERVER") {
    return { id: network.id, name: network.name, servers: [], reason: dhcp.mode === "RELAY"
      ? "DHCP relay does not reveal the DNS servers given to devices."
      : "This network has no UniFi DHCP server." };
  }
  const servers = dhcp.dnsServerIpAddressesOverride?.length
    ? dhcp.dnsServerIpAddressesOverride
    : [network.ipv4Configuration?.hostIpAddress ?? ""];
  if (!servers.length || servers.some((address) => !isIP(address))) {
    return { id: network.id, name: network.name, servers: [], reason: "DHCP DNS server address is unavailable or invalid." };
  }
  return { id: network.id, name: network.name, servers: [...new Set(servers)].sort(), reason: null };
}

const unavailable = (reason: string): ResolverContext => ({ source: "unknown", url: null, networks: [], reason });
const doh = (url: string): ResolverContext => ({ source: "doh", url, networks: [], reason: null });

export type ResolverContexts = { household: ResolverContext; groups: Map<string, ResolverContext> };

function discoveredContext(networks: ResolverNetwork[]): ResolverContext {
  if (!networks.length) return unavailable("No managed network is available for this scope.");
  return { source: "dhcp", url: null, networks, reason: networks.find((network) => network.reason)?.reason ?? null };
}

export function contextKey(context: unknown): string {
  const normalize = (value: unknown): unknown => Array.isArray(value) ? value.map(normalize)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]))
      : value;
  return JSON.stringify(normalize(context));
}

/** Refresh the saved source identity and clear only scopes whose resolver changed. */
export async function refreshResolverContexts(retries = 0): Promise<ResolverContexts> {
  const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
  const groups = await prisma().group.findMany({ include: { devices: { select: { networkId: true } } } });
  const requiresDiscovery = !household.dohUrl;
  let networks: ResolverNetwork[] = [];
  let discoveryError: string | null = null;
  if (requiresDiscovery) {
    try {
      if (!household.unifiSiteId) throw new Error("UniFi is not configured.");
      const details = await loadNetworkDetails(clientForHousehold(household), household.unifiSiteId);
      networks = details
        .filter((network) => networkInScope({
          manageAllNetworks: household.unifiManageAllNetworks,
          managedNetworkIds: household.unifiManagedNetworkIds,
        }, network.id))
        .map((network) => discoveredNetwork(network as Network))
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch {
      discoveryError = "Could not read UniFi network settings.";
    }
  }

  const householdContext = household.dohUrl ? doh(household.dohUrl)
    : discoveryError ? unavailable(discoveryError) : discoveredContext(networks);
  const groupContexts = new Map<string, ResolverContext>();
  for (const group of groups) {
    const context = group.dohOverrideUrl ? doh(group.dohOverrideUrl)
      : household.dohUrl ? householdContext
      : discoveryError ? unavailable(discoveryError)
      : discoveredContext(networks.filter((network) =>
        group.devices.some((device) => device.networkId === network.id)));
    groupContexts.set(group.id, context);
  }

  const applied = await withUpstreamLock(async (tx) => {
    // UniFi reads happen outside the lock. A settings or assignment change during
    // that read must not install an older snapshot over the new configuration.
    const currentHousehold = await tx.household.findUniqueOrThrow({ where: { id: "default" } });
    const currentGroups = await tx.group.findMany({ include: { devices: { select: { networkId: true } } } });
    const identity = (value: typeof household, rows: typeof groups) => ({
      dohUrl: value.dohUrl,
      unifiSiteId: value.unifiSiteId,
      unifiManageAllNetworks: value.unifiManageAllNetworks,
      unifiManagedNetworkIds: value.unifiManagedNetworkIds,
      groups: rows.map((group) => ({
        id: group.id, dohOverrideUrl: group.dohOverrideUrl,
        networkIds: group.devices.map((device) => device.networkId).sort(),
      })).sort((a, b) => a.id.localeCompare(b.id)),
    });
    if (contextKey(identity(household, groups)) !== contextKey(identity(currentHousehold, currentGroups))) return false;
    const savedHousehold = await tx.household.findUniqueOrThrow({ where: { id: "default" }, select: { upstreamResolverSnapshot: true } });
    if (contextKey(savedHousehold.upstreamResolverSnapshot) !== contextKey(householdContext)) {
      await tx.upstreamCheck.deleteMany({ where: { groupId: null } });
      await tx.household.update({ where: { id: "default" }, data: { upstreamResolverSnapshot: householdContext } });
    }
    for (const group of groups) {
      const context = groupContexts.get(group.id)!;
      const savedGroup = await tx.group.findUnique({ where: { id: group.id }, select: { upstreamResolverSnapshot: true } });
      if (savedGroup && contextKey(savedGroup.upstreamResolverSnapshot) !== contextKey(context)) {
        await tx.upstreamCheck.deleteMany({ where: { groupId: group.id } });
        await tx.group.update({ where: { id: group.id }, data: { upstreamResolverSnapshot: context } });
      }
    }
    return true;
  });
  if (!applied) {
    if (retries >= 2) throw new Error("Resolver configuration changed during discovery.");
    return refreshResolverContexts(retries + 1);
  }
  return { household: householdContext, groups: groupContexts };
}
