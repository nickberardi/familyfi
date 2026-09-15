import { createFixtureUnifiClient } from "@/server/unifi/dev-mock";

export function fixtureUnifiClient() {
  return createFixtureUnifiClient();
}

export function policyMacs(policy: { source?: { trafficFilter?: { macAddressFilter?: { macAddresses?: string[] } } } }) {
  return policy.source?.trafficFilter?.macAddressFilter?.macAddresses ?? [];
}
