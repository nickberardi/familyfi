import type { GatewayDeviceHealth, GatewayHealth } from "@/lib/types";
import { prisma } from "./db";
import { clientForHousehold } from "./unifi/connection";
import { consoleAddress, findGatewayDevice, hasGatewayFeature, networkGatewayAddresses } from "./unifi/gateway-device";
import { loadNetworkDetails } from "./unifi/networks";
import { unifiRequestLoad } from "./unifi/request-meter";
import type { DeviceLatestStatistics, SiteDeviceOverview } from "./unifi/types";

function deviceHealth(device: SiteDeviceOverview, statistics: DeviceLatestStatistics | null, gateway: boolean): GatewayDeviceHealth {
  return {
    id: device.id,
    name: device.name,
    model: device.model ?? null,
    state: device.state ?? null,
    gateway,
    reported: statistics !== null,
    cpuUtilizationPct: statistics?.cpuUtilizationPct ?? null,
    memoryUtilizationPct: statistics?.memoryUtilizationPct ?? null,
    loadAverage1Min: statistics?.loadAverage1Min ?? null,
    loadAverage5Min: statistics?.loadAverage5Min ?? null,
    loadAverage15Min: statistics?.loadAverage15Min ?? null,
    uptimeSec: statistics?.uptimeSec ?? null,
    lastHeartbeatAt: statistics?.lastHeartbeatAt ?? null,
  };
}

/**
 * The UniFi devices' latest CPU, memory and load, gateway first, beside the requests this
 * server has sent the console. Asked only when someone opens it: nothing polls this.
 */
export async function gatewayHealth(now = new Date()): Promise<GatewayHealth> {
  const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
  let devices: GatewayDeviceHealth[] | null = null;
  let devicesError: string | null = null;
  if (!household.unifiKeyLastFour || !household.unifiSiteId) {
    devicesError = "Connect a UniFi console first.";
  } else {
    const siteId = household.unifiSiteId;
    try {
      const client = clientForHousehold(household);
      const listed = await client.listSiteDevices(siteId);
      const statistics = await Promise.all(
        // A device that will not report still appears, marked unreported, rather than failing the rest.
        listed.map((device) => client.getDeviceStatistics(siteId, device.id).catch(() => null)),
      );
      // Only a console that marks no gateway costs the network reads; failing them costs only the match.
      const networks = hasGatewayFeature(listed) ? [] : await loadNetworkDetails(client, siteId).catch(() => []);
      const gateway = findGatewayDevice(listed, [...networkGatewayAddresses(networks), consoleAddress(household.unifiBaseUrl)]);
      devices = listed
        .map((device, index) => deviceHealth(device, statistics[index] ?? null, device === gateway))
        .sort((a, b) => Number(b.gateway) - Number(a.gateway) || a.name.localeCompare(b.name));
    } catch (error) {
      devicesError = error instanceof Error ? error.message : "The UniFi console could not be reached.";
    }
  }
  // Read after asking the console, so the window includes the requests this check just made.
  return { checkedAt: now.toISOString(), devices, devicesError, requests: unifiRequestLoad() };
}
