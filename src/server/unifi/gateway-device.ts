import type { NetworkDetails, SiteDeviceOverview } from "./types";

/** Gateway models: the last resort, for a console that names neither the gateway's role nor one of its addresses. */
const GATEWAY_MODEL = /^(UDM|UDR|UCG|UXG|USG|UDW|EFG|UX7?\b)/i;

function normalAddress(address: string): string {
  return address.trim().replace(/^\[|\]$/g, "").toLowerCase();
}

/** The console's address from the local integration URL; a cloud connection has none. */
export function consoleAddress(baseUrl: string | null): string | null {
  if (!baseUrl) return null;
  try {
    return normalAddress(new URL(baseUrl).hostname);
  } catch {
    return null;
  }
}

/** The gateway's own address on each of its networks, one per VLAN. */
export function networkGatewayAddresses(networks: NetworkDetails[]): string[] {
  return networks.flatMap((network) => (network.ipv4Configuration?.hostIpAddress ? [network.ipv4Configuration.hostIpAddress] : []));
}

export function hasGatewayFeature(devices: SiteDeviceOverview[]): boolean {
  return devices.some((device) => device.features?.includes("gateway"));
}

/**
 * Which listed device is the gateway: the one the console says has the gateway feature; else
 * the one at the first of `gatewayAddresses` any device has (the gateway's address on each of
 * its networks, then the console FamilyFi talks to); else, at worst, the one whose model is a gateway's.
 */
export function findGatewayDevice(devices: SiteDeviceOverview[], gatewayAddresses: (string | null)[]): SiteDeviceOverview | null {
  const byFeature = devices.find((device) => device.features?.includes("gateway"));
  if (byFeature) return byFeature;
  // In order: an earlier address (a network's own gateway) outranks a later one (the console, which could be another device).
  for (const address of gatewayAddresses) {
    if (!address) continue;
    const byAddress = devices.find((device) => device.ipAddress !== undefined && normalAddress(device.ipAddress) === normalAddress(address));
    if (byAddress) return byAddress;
  }
  return devices.find((device) => device.model !== undefined && GATEWAY_MODEL.test(device.model.trim())) ?? null;
}
