import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MockUnifiClient, createMockUnifiState, type MockUnifiState } from "./mock";
import type {
  ClientOverview,
  DpiCatalogItem,
  FirewallPolicy,
  FirewallZone,
  NetworkDetails,
  SiteOverview,
  UnifiPage,
  WifiBroadcast,
} from "./types";

export const DEV_MOCK_API_KEY = "mock-unifi-key";
export const DEV_MOCK_BASE_URL = "https://127.0.0.1/proxy/network/integration";
export const DEV_MOCK_SITE_ID = "11111111-1111-4111-8111-111111111111";
export const DEV_MOCK_INTERNAL_ZONE = "33333333-3333-4333-8333-333333333333";
export const DEV_MOCK_IOT_ZONE = "33333333-3333-4333-8333-333333333334";
export const DEV_MOCK_INTERNAL_NETWORK = "22222222-2222-4222-8222-222222222222";
export const DEV_MOCK_IOT_NETWORK = "22222222-2222-4222-8222-222222222223";
export const DEV_MOCK_GUEST_NETWORK = "22222222-2222-4222-8222-222222222226";
export const DEV_MOCK_ADMIN_POLICY_ID = "55555555-5555-4555-8555-555555555555";
export const DEV_MOCK_ROGUE_POLICY_ID = "66666666-6666-4666-8666-666666666666";

const FRIENDLY_SITE = "Home";
const FRIENDLY_NETWORKS: Record<string, string> = {
  [DEV_MOCK_INTERNAL_NETWORK]: "LAN",
  [DEV_MOCK_IOT_NETWORK]: "IoT",
  [DEV_MOCK_GUEST_NETWORK]: "Visitor Wi-Fi",
};
const FRIENDLY_CLIENTS: Record<string, string> = {
  "44444444-4444-4444-8444-444444444441": "Kids iPad",
  "44444444-4444-4444-8444-444444444442": "Living Room TV",
  "44444444-4444-4444-8444-444444444443": "Sam Phone",
  "44444444-4444-4444-8444-444444444446": "Visitor iPad",
};

const DEV_MOCK_GUEST_ZONE = "33333333-3333-4333-8333-333333333336";
const DEV_MOCK_GUEST_CLIENT = "44444444-4444-4444-8444-444444444446";

function fixturesDir() {
  return join(process.cwd(), "tests/fixtures/unifi");
}

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixturesDir(), name), "utf8")) as T;
}

function applyFriendlyNames(state: MockUnifiState): MockUnifiState {
  return {
    ...state,
    sites: state.sites.map((site) => ({ ...site, name: FRIENDLY_SITE })),
    networks: state.networks.map((network) => ({
      ...network,
      name: FRIENDLY_NETWORKS[network.id] ?? network.name,
    })),
    clients: state.clients.map((client) => ({
      ...client,
      name: FRIENDLY_CLIENTS[client.id] ?? client.name,
    })),
  };
}

export function createFixtureUnifiState(options?: { friendlyNames?: boolean; guestDemo?: boolean }): MockUnifiState {
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
    policies: [admin, rogue],
    ordering: { beforeSystemDefined: [], afterSystemDefined: [DEV_MOCK_ADMIN_POLICY_ID, rogue.id] },
    dpiCategories: readJson<UnifiPage<DpiCatalogItem>>("dpi-categories.page.json").data,
    dpiApplications: readJson<UnifiPage<DpiCatalogItem>>("dpi-applications.page.json").data,
  });
  if (options?.guestDemo) {
    state.zones.push({ id: DEV_MOCK_GUEST_ZONE, name: "Hotspot", networkIds: [DEV_MOCK_GUEST_NETWORK] });
    state.networks.push({
      id: DEV_MOCK_GUEST_NETWORK, name: "Visitor Wi-Fi", default: false, enabled: true,
      management: "GATEWAY", vlanId: 30, zoneId: DEV_MOCK_GUEST_ZONE,
      ipv4Configuration: { hostIpAddress: "203.0.113.1", prefixLength: 24 },
    });
    state.clients.push({
      id: DEV_MOCK_GUEST_CLIENT, name: "Visitor iPad", type: "WIRELESS",
      macAddress: "02:00:00:00:00:46", ipAddress: "203.0.113.46",
      access: { type: "GUEST", authorized: false },
    });
    state.networkClientIds.set(DEV_MOCK_GUEST_NETWORK, new Set([DEV_MOCK_GUEST_CLIENT]));
    state.wifiBroadcasts.push({
      id: "77777777-7777-4777-8777-777777777777", enabled: true, type: "STANDARD",
      network: { type: "SPECIFIC", networkId: DEV_MOCK_GUEST_NETWORK },
      hotspotConfiguration: { type: "CAPTIVE_PORTAL" },
    } satisfies WifiBroadcast);
  }
  return options?.friendlyNames ? applyFriendlyNames(state) : state;
}

export function createFixtureUnifiClient(options?: { friendlyNames?: boolean; guestDemo?: boolean }) {
  return new MockUnifiClient(createFixtureUnifiState(options));
}

let shared: MockUnifiClient | undefined;

export function getSharedDevMockClient(): MockUnifiClient {
  if (!shared) shared = createFixtureUnifiClient({ friendlyNames: true, guestDemo: process.env.NODE_ENV === "development" });
  return shared;
}

export function resetDevMockClientForTests() {
  shared = undefined;
}
