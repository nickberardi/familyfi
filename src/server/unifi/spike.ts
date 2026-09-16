import { normalizeMac } from "../mac";
import type { UnifiClient } from "./client";
import { UnifiHttpError } from "./errors";
import { groupMacsBySourceZone, mapClientsToZones, selectExternalZone } from "./mapping";
import { orderedPolicyIds, relativeOrderPreserved } from "./ordering";
import { INTERNET_BLOCK_ACTION, internetBlockPolicy, isOwnedPolicyName, spikePolicyName, toPolicyUpdate } from "./payloads";
import type {
  ClientOverview,
  ClientZoneMapping,
  FirewallPolicy,
  FirewallZone,
  NetworkDetails,
  PolicyOrdering,
  SiteOverview,
} from "./types";

export type SpikeInventory = {
  applicationVersion: string;
  site: SiteOverview;
  zones: FirewallZone[];
  networks: NetworkDetails[];
  clients: ClientOverview[];
  policies: FirewallPolicy[];
  ordering: PolicyOrdering;
  mappings: ClientZoneMapping[];
  externalZone: FirewallZone;
};

export type SpikeApplyResult = {
  created: FirewallPolicy[];
  orderingAfter: PolicyOrdering;
  adminOrderPreserved: boolean;
};

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

export async function discoverInventory(
  client: UnifiClient,
  siteId?: string,
): Promise<SpikeInventory> {
  const info = await client.getInfo();
  const sites = await client.listSites();
  if (sites.length === 0) throw new Error("UniFi returned no sites.");
  const site = siteId ? sites.find((item) => item.id === siteId) : sites.length === 1 ? sites[0] : undefined;
  if (!site) {
    const names = sites.map((item) => `${item.name} (${item.id})`).join(", ");
    throw new Error(`Set UNIFI_SITE_ID. Sites: ${names}`);
  }
  const [zones, networks, clients, policies] = await Promise.all([
    client.listZones(site.id),
    loadNetworkDetails(client, site.id),
    client.listClients(site.id),
    client.listPolicies(site.id),
  ]);
  let ordering: PolicyOrdering;
  try {
    ordering = await client.getPolicyOrdering(site.id);
  } catch (error) {
    if (!(error instanceof UnifiHttpError) || error.status !== 400) throw error;
    ordering = { beforeSystemDefined: [], afterSystemDefined: [] };
    for (const zone of zones) {
      try {
        const part = await client.getPolicyOrdering(site.id, zone.id);
        ordering.beforeSystemDefined.push(...part.beforeSystemDefined);
        ordering.afterSystemDefined.push(...part.afterSystemDefined);
      } catch {
        // Zone has no ordering document.
      }
    }
    if (ordering.afterSystemDefined.length === 0 && ordering.beforeSystemDefined.length === 0) {
      ordering.afterSystemDefined = [...policies]
        .sort((a, b) => a.index - b.index)
        .map((policy) => policy.id);
    }
  }
  const networkClientIds = await loadNetworkClientIds(client, site.id, networks);
  const mappings = mapClientsToZones({ clients, networks, zones, networkClientIds });
  const externalZone = selectExternalZone(zones);
  if (!externalZone) {
    throw new Error(
      `No External/WAN destination zone found. Zones: ${zones.map((zone) => zone.name).join(", ") || "(none)"}`,
    );
  }
  return {
    applicationVersion: info.applicationVersion,
    site,
    zones,
    networks,
    clients,
    policies,
    ordering,
    mappings,
    externalZone,
  };
}

export async function applyInternetBlocks(
  client: UnifiClient,
  inventory: SpikeInventory,
  macs: string[],
): Promise<SpikeApplyResult> {
  const wanted = new Set(macs.map(normalizeMac));
  const selected = inventory.mappings.filter((mapping) => mapping.macAddress && wanted.has(mapping.macAddress));
  const missing = [...wanted].filter((mac) => !selected.some((mapping) => mapping.macAddress === mac));
  if (missing.length) {
    throw new Error(`Test MAC not found among connected clients: ${missing.join(", ")}`);
  }
  const unresolved = selected.filter((mapping) => !mapping.sourceZoneId);
  if (unresolved.length) {
    throw new Error(
      `Could not map client to a source zone (official client objects have no networkId): ${unresolved
        .map((item) => item.macAddress)
        .join(", ")}`,
    );
  }
  const grouped = groupMacsBySourceZone(selected);
  const created: FirewallPolicy[] = [];
  try {
    for (const [sourceZoneId, zoneMacs] of grouped) {
      const zoneName = inventory.zones.find((zone) => zone.id === sourceZoneId)?.name ?? sourceZoneId;
      const body = internetBlockPolicy({
        name: spikePolicyName(zoneName),
        sourceZoneId,
        destinationZoneId: inventory.externalZone.id,
        macAddresses: zoneMacs,
        enabled: true,
        action: INTERNET_BLOCK_ACTION,
      });
      created.push(await client.createPolicy(inventory.site.id, body));
    }
  } catch (error) {
    if (created.length) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} Created policy ids (cleanup needed): ${created.map((p) => p.id).join(", ")}`,
      );
    }
    throw error;
  }
  let orderingAfter = inventory.ordering;
  let adminOrderPreserved = true;
  try {
    const sourceZoneId = created[0]?.source.zoneId;
    orderingAfter = await client.getPolicyOrdering(inventory.site.id, sourceZoneId);
    adminOrderPreserved = relativeOrderPreserved(
      orderedPolicyIds(inventory.ordering),
      orderedPolicyIds(orderingAfter),
    );
  } catch {
    adminOrderPreserved = false;
  }
  return {
    created,
    orderingAfter,
    adminOrderPreserved,
  };
}

export async function setPoliciesEnabled(
  client: UnifiClient,
  siteId: string,
  policies: FirewallPolicy[],
  enabled: boolean,
): Promise<FirewallPolicy[]> {
  const updated: FirewallPolicy[] = [];
  for (const policy of policies) {
    const latest = await client.getPolicy(siteId, policy.id);
    updated.push(await client.updatePolicy(siteId, policy.id, toPolicyUpdate(latest, { enabled })));
  }
  return updated;
}

export async function deletePolicies(
  client: UnifiClient,
  siteId: string,
  policyIds: string[],
): Promise<{ deleted: string[]; failed: { id: string; error: string }[] }> {
  const deleted: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const id of policyIds) {
    try {
      await client.deletePolicy(siteId, id);
      deleted.push(id);
    } catch (error) {
      failed.push({ id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { deleted, failed };
}

export function ownedSpikePolicies(policies: FirewallPolicy[]): FirewallPolicy[] {
  return policies.filter((policy) => isOwnedPolicyName(policy.name) && policy.name.includes(" Spike "));
}
