import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MockUnifiClient, createMockUnifiState } from "@/server/unifi/mock";
import { ADMIN_POLICY_ID } from "./db";
import type { ClientOverview, FirewallPolicy, FirewallZone, NetworkDetails, SiteOverview, UnifiPage } from "@/server/unifi/types";

const fixtures = join(__dirname, "../fixtures/unifi");

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8")) as T;
}

export function fixtureUnifiClient() {
  const admin = readJson<UnifiPage<FirewallPolicy>>("policies.page.json").data[0]!;
  const rogue: FirewallPolicy = {
    ...admin,
    id: "66666666-6666-4666-8666-666666666666",
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
    ordering: { beforeSystemDefined: [], afterSystemDefined: [ADMIN_POLICY_ID, rogue.id] },
  });
  return new MockUnifiClient(state);
}

export function policyMacs(policy: { source?: { trafficFilter?: { macAddressFilter?: { macAddresses?: string[] } } } }) {
  return policy.source?.trafficFilter?.macAddressFilter?.macAddresses ?? [];
}
