import { normalizeMac } from "../mac";
import type { ClientOverview, ClientZoneMapping, FirewallZone, NetworkDetails } from "./types";

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((nums[0]! << 24) | (nums[1]! << 16) | (nums[2]! << 8) | nums[3]!) >>> 0;
}

export function ipv4InCidr(ip: string, networkAddress: string, prefixLength: number): boolean {
  if (prefixLength < 0 || prefixLength > 32) return false;
  const address = ipv4ToInt(ip);
  const network = ipv4ToInt(networkAddress);
  if (address === null || network === null) return false;
  const mask = prefixLength === 0 ? 0 : (~0 << (32 - prefixLength)) >>> 0;
  return (address & mask) === (network & mask);
}

export function ipv4InSubnetString(ip: string, subnet: string): boolean {
  if (subnet.includes("/")) {
    const [network, prefixRaw] = subnet.split("/");
    const prefix = Number(prefixRaw);
    if (!network || !Number.isInteger(prefix)) return false;
    return ipv4InCidr(ip, network, prefix);
  }
  return ip === subnet;
}

function clientOnNetwork(client: ClientOverview, network: NetworkDetails, clientIdsOnNetwork: Set<string>): boolean {
  if (clientIdsOnNetwork.has(client.id)) return true;
  const ip = client.ipAddress;
  if (!ip || ip.includes(":")) return false;
  const v4 = network.ipv4Configuration;
  if (!v4) return false;
  if (ipv4InCidr(ip, v4.hostIpAddress, v4.prefixLength)) return true;
  return (v4.additionalHostIpSubnets ?? []).some((subnet) => ipv4InSubnetString(ip, subnet));
}

export function zoneByNetworkId(zones: FirewallZone[], networkId: string): FirewallZone | undefined {
  return zones.find((zone) => zone.networkIds.includes(networkId) || zone.id === networkId);
}

export function selectExternalZone(zones: FirewallZone[]): FirewallZone | undefined {
  const rank = (name: string) => {
    const n = name.trim().toLowerCase();
    if (n === "external") return 0;
    if (n === "wan") return 1;
    if (n === "internet") return 2;
    return 99;
  };
  return [...zones].filter((zone) => rank(zone.name) < 99).sort((a, b) => rank(a.name) - rank(b.name))[0];
}

export function mapClientsToZones(input: {
  clients: ClientOverview[];
  networks: NetworkDetails[];
  zones: FirewallZone[];
  networkClientIds?: Map<string, Set<string>>;
}): ClientZoneMapping[] {
  return input.clients.map((client) => {
    let macAddress = "";
    try {
      macAddress = client.macAddress ? normalizeMac(client.macAddress) : "";
    } catch {
      macAddress = "";
    }
    const refs = input.networkClientIds;
    const byReference = input.networks.find((network) => refs?.get(network.id)?.has(client.id));
    if (byReference) {
      const zone = zoneByNetworkId(input.zones, byReference.id) ?? input.zones.find((z) => z.id === byReference.zoneId);
      return {
        clientId: client.id,
        macAddress,
        ipAddress: client.ipAddress ?? null,
        networkId: byReference.id,
        sourceZoneId: zone?.id ?? byReference.zoneId ?? null,
        method: "network-reference",
      };
    }
    const bySubnet = input.networks.find((network) => clientOnNetwork(client, network, new Set()));
    if (bySubnet) {
      const zone =
        input.zones.find((z) => z.id === bySubnet.zoneId) ?? zoneByNetworkId(input.zones, bySubnet.id);
      return {
        clientId: client.id,
        macAddress,
        ipAddress: client.ipAddress ?? null,
        networkId: bySubnet.id,
        sourceZoneId: zone?.id ?? bySubnet.zoneId ?? null,
        method: "ipv4-subnet",
      };
    }
    return {
      clientId: client.id,
      macAddress,
      ipAddress: client.ipAddress ?? null,
      networkId: null,
      sourceZoneId: null,
      method: "unresolved",
    };
  });
}

export function groupMacsBySourceZone(mappings: ClientZoneMapping[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const mapping of mappings) {
    if (!mapping.sourceZoneId || !mapping.macAddress) continue;
    const list = grouped.get(mapping.sourceZoneId) ?? [];
    if (!list.includes(mapping.macAddress)) list.push(mapping.macAddress);
    grouped.set(mapping.sourceZoneId, list);
  }
  return grouped;
}
