import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEV_APPS, DEV_DEVICES, devDeviceIp } from "../dev-household";
import { MockUnifiClient, createMockUnifiState, type MockUnifiState } from "./mock";
import type {
  ClientOverview,
  DeviceLatestStatistics,
  DpiCatalogItem,
  FirewallPolicy,
  FirewallZone,
  NetworkDetails,
  SiteOverview,
  SiteDeviceOverview,
  UnifiPage,
  WifiBroadcastDetails,
} from "./types";

export const DEV_MOCK_API_KEY = "mock-unifi-key";
export const DEV_MOCK_BASE_URL = "https://127.0.0.1/proxy/network/integration";
export const DEV_MOCK_SITE_ID = "11111111-1111-4111-8111-111111111111";
export const DEV_MOCK_INTERNAL_ZONE = "33333333-3333-4333-8333-333333333333";
export const DEV_MOCK_IOT_ZONE = "33333333-3333-4333-8333-333333333334";
export const DEV_MOCK_INTERNAL_NETWORK = "22222222-2222-4222-8222-222222222222";
export const DEV_MOCK_IOT_NETWORK = "22222222-2222-4222-8222-222222222223";
export const DEV_MOCK_ADMIN_POLICY_ID = "55555555-5555-4555-8555-555555555555";
export const DEV_MOCK_ROGUE_POLICY_ID = "66666666-6666-4666-8666-666666666666";

const FRIENDLY_SITE = "Home";
const FRIENDLY_NETWORKS: Record<string, string> = {
  [DEV_MOCK_INTERNAL_NETWORK]: "LAN",
  [DEV_MOCK_IOT_NETWORK]: "IoT",
};

/** The household's online devices, connected an hour or so ago, in place of the fixture's three. */
function householdClients(accessPoints: SiteDeviceOverview[]): ClientOverview[] {
  const connectedAt = new Date(Date.now() - 75 * 60 * 1000).toISOString();
  return DEV_DEVICES.filter((item) => item.online).map((item, index) => ({
    id: `44444444-4444-4444-8444-${(0x100 + index).toString(16).padStart(12, "0")}`,
    name: item.name,
    type: item.type,
    connectedAt,
    ipAddress: devDeviceIp(item),
    macAddress: item.mac,
    ...(item.accessPoint === undefined ? {} : { uplinkDeviceId: accessPoints[item.accessPoint]?.id }),
  }));
}

function fixturesDir() {
  return join(process.cwd(), "tests/fixtures/unifi");
}

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixturesDir(), name), "utf8")) as T;
}

/**
 * The household's Wi-Fi and the settings the checkup reads: mDNS forwarded on LAN but not IoT, IoT
 * handing out a Pi-hole for DNS, and an IoT Wi-Fi on 5 GHz only with Multicast to Unicast on, so the
 * demo has findings to show.
 */
const FRIENDLY_NETWORK_SETTINGS: Record<string, { mdnsForwardingEnabled: boolean; dnsServers: string[] | null }> = {
  [DEV_MOCK_INTERNAL_NETWORK]: { mdnsForwardingEnabled: true, dnsServers: null },
  [DEV_MOCK_IOT_NETWORK]: { mdnsForwardingEnabled: false, dnsServers: ["198.51.100.53"] },
};

const FRIENDLY_WIFI: WifiBroadcastDetails[] = [
  {
    id: "77777777-7777-4777-8777-777777777701",
    name: "Home",
    type: "STANDARD",
    enabled: true,
    network: { type: "NATIVE" },
    securityConfiguration: { type: "WPA2_WPA3_PERSONAL" },
    broadcastingFrequenciesGHz: [2.4, 5],
    multicastToUnicastConversionEnabled: false,
    clientIsolationEnabled: false,
  },
  {
    id: "77777777-7777-4777-8777-777777777702",
    name: "Home IoT",
    type: "STANDARD",
    enabled: true,
    network: { type: "SPECIFIC", networkId: DEV_MOCK_IOT_NETWORK },
    securityConfiguration: { type: "WPA2_PERSONAL" },
    broadcastingFrequenciesGHz: [5],
    multicastToUnicastConversionEnabled: true,
    clientIsolationEnabled: false,
  },
];

function applyFriendlyNames(state: MockUnifiState): MockUnifiState {
  return {
    ...state,
    sites: state.sites.map((site) => ({ ...site, name: FRIENDLY_SITE })),
    networks: state.networks.map((network) => {
      const settings = FRIENDLY_NETWORK_SETTINGS[network.id];
      return {
        ...network,
        name: FRIENDLY_NETWORKS[network.id] ?? network.name,
        ...(settings
          ? {
              mdnsForwardingEnabled: settings.mdnsForwardingEnabled,
              ...(network.ipv4Configuration
                ? { ipv4Configuration: { ...network.ipv4Configuration, dhcpConfiguration: { mode: "SERVER", dnsServerIpAddressesOverride: settings.dnsServers } } }
                : {}),
            }
          : {}),
      };
    }),
    wifiBroadcasts: FRIENDLY_WIFI.map((wifi) => ({ ...wifi })),
    clients: householdClients(state.siteDevices),
    dpiApplications: [...state.dpiApplications, ...DEV_APPS.map((app) => ({ ...app }))],
  };
}

/**
 * The fixture gateway. With `friendlyNames` it is the mock household's gateway:
 * named site and networks, the household's devices as clients, and a few named apps.
 */
export function createFixtureUnifiState(options?: { friendlyNames?: boolean }): MockUnifiState {
  const admin = readJson<UnifiPage<FirewallPolicy>>("policies.page.json").data[0]!;
  const rogue: FirewallPolicy = {
    ...admin,
    id: DEV_MOCK_ROGUE_POLICY_ID,
    name: "FamilyFi Rogue Prefix",
    index: 11,
  };
  const state = createMockUnifiState({
    version: "10.6.106",
    sites: readJson<UnifiPage<SiteOverview>>("sites.page.json").data,
    networks: readJson<UnifiPage<NetworkDetails>>("networks.page.json").data,
    zones: readJson<UnifiPage<FirewallZone>>("zones.page.json").data,
    clients: readJson<UnifiPage<ClientOverview>>("clients.page.json").data,
    siteDevices: readJson<UnifiPage<SiteDeviceOverview>>("site-devices.page.json").data,
    deviceStatistics: new Map(Object.entries(readJson<Record<string, DeviceLatestStatistics>>("device-statistics.json"))),
    policies: [admin, rogue],
    ordering: { beforeSystemDefined: [], afterSystemDefined: [DEV_MOCK_ADMIN_POLICY_ID, rogue.id] },
    dpiCategories: readJson<UnifiPage<DpiCatalogItem>>("dpi-categories.page.json").data,
    dpiApplications: readJson<UnifiPage<DpiCatalogItem>>("dpi-applications.page.json").data,
  });
  return options?.friendlyNames ? applyFriendlyNames(state) : state;
}

export function createFixtureUnifiClient(options?: { friendlyNames?: boolean }) {
  return new MockUnifiClient(createFixtureUnifiState(options));
}

let shared: MockUnifiClient | undefined;

export function getSharedDevMockClient(): MockUnifiClient {
  if (!shared) shared = createFixtureUnifiClient({ friendlyNames: true });
  return shared;
}

export function resetDevMockClientForTests() {
  shared = undefined;
}
