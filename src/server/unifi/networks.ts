import { mapLimited } from "@/lib/concurrency";
import type { UnifiClient } from "./client";
import type { NetworkDetails } from "./types";

/** Requests kept in flight to one console at once: enough to overlap round trips, few enough to spare it. */
export const GATEWAY_CONCURRENCY = 4;

/** Every network with its details; a network whose details cannot be read keeps its overview. */
export async function loadNetworkDetails(client: UnifiClient, siteId: string): Promise<NetworkDetails[]> {
  const overviews = await client.listNetworks(siteId);
  return mapLimited(overviews, GATEWAY_CONCURRENCY, async (overview) => {
    try {
      return await client.getNetwork(siteId, overview.id);
    } catch {
      return { ...overview, detailsUnread: true };
    }
  });
}

/** The client ids each network references, by network id; empty for a network that cannot be read. */
export async function loadNetworkClientIds(
  client: UnifiClient,
  siteId: string,
  networks: NetworkDetails[],
): Promise<Map<string, Set<string>>> {
  const entries = await mapLimited(networks, GATEWAY_CONCURRENCY, async (network) => {
    try {
      const refs = await client.getNetworkReferences(siteId, network.id);
      const ids = new Set<string>();
      for (const resource of refs.referenceResources) {
        if (resource.resourceType !== "CLIENT") continue;
        for (const ref of resource.references ?? []) ids.add(ref.referenceId);
      }
      return [network.id, ids] as const;
    } catch {
      return [network.id, new Set<string>()] as const;
    }
  });
  return new Map(entries);
}
