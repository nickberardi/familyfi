export type NetworkScope = {
  manageAllNetworks: boolean;
  managedNetworkIds: string[];
};

export type PublicUnifiNetwork = {
  id: string;
  name: string;
  vlanId: number;
  zoneId: string | null;
};

/** Unknown VLAN is never in scope. Empty allowlist with manageAllNetworks false monitors nothing. */
export function networkInScope(scope: NetworkScope, networkId: string | null | undefined): boolean {
  if (!networkId) return false;
  if (scope.manageAllNetworks) return true;
  return scope.managedNetworkIds.includes(networkId);
}

export function publicUnifiNetwork(network: {
  id: string;
  name: string;
  vlanId: number;
  zoneId?: string | null;
}): PublicUnifiNetwork {
  return {
    id: network.id,
    name: network.name,
    vlanId: network.vlanId,
    zoneId: network.zoneId ?? null,
  };
}

export function resolveNetworkScope(input: {
  manageAllNetworks?: boolean;
  managedNetworkIds?: string[];
  previous?: NetworkScope;
}): NetworkScope {
  const previous = input.previous ?? { manageAllNetworks: false, managedNetworkIds: [] };
  const manageAllNetworks = input.manageAllNetworks ?? previous.manageAllNetworks;
  const managedNetworkIds = input.managedNetworkIds ?? previous.managedNetworkIds;
  if (manageAllNetworks) return { manageAllNetworks: true, managedNetworkIds: [] };
  return { manageAllNetworks: false, managedNetworkIds: [...new Set(managedNetworkIds)] };
}
