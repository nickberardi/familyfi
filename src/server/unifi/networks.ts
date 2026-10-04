import type { UnifiClient } from "./client";
import type { NetworkDetails } from "./types";

/** Every network with its details; a network whose details cannot be read keeps its overview. */
export async function loadNetworkDetails(client: UnifiClient, siteId: string): Promise<NetworkDetails[]> {
  const overviews = await client.listNetworks(siteId);
  const details: NetworkDetails[] = [];
  for (const overview of overviews) {
    try {
      details.push(await client.getNetwork(siteId, overview.id));
    } catch {
      details.push(overview);
    }
  }
  return details;
}

/** The client ids each network references, by network id; empty for a network that cannot be read. */
export async function loadNetworkClientIds(
  client: UnifiClient,
  siteId: string,
  networks: NetworkDetails[],
): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  for (const network of networks) {
    try {
      const refs = await client.getNetworkReferences(siteId, network.id);
      const ids = new Set<string>();
      for (const resource of refs.referenceResources) {
        if (resource.resourceType !== "CLIENT") continue;
        for (const ref of resource.references ?? []) ids.add(ref.referenceId);
      }
      map.set(network.id, ids);
    } catch {
      map.set(network.id, new Set());
    }
  }
  return map;
}
