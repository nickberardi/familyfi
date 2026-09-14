import { encryptSecret } from "./crypto";
import { prisma } from "./db";
import { UnifiConfigError } from "./unifi/errors";
import { clientForHousehold, connectionIdentity, probeClient } from "./unifi/connection";
import { enqueueChange } from "./changes";
import { publicUnifiNetwork, resolveNetworkScope, type NetworkScope, type PublicUnifiNetwork } from "./unifi/scope";
import { loadNetworkDetails } from "./unifi/spike";
import type { Household } from "@prisma/client";

export async function testUnifiConnection(input: {
  apiKey: string;
  baseUrl?: string;
  consoleId?: string;
  siteId?: string;
  tlsInsecure?: boolean;
}) {
  const client = probeClient(input);
  const [info, sites] = await Promise.all([client.getInfo(), client.listSites()]);
  if (sites.length === 0) throw new UnifiConfigError("UniFi returned no sites.");
  const site = input.siteId
    ? sites.find((item) => item.id === input.siteId)
    : sites.length === 1
      ? sites[0]
      : undefined;
  if (!site) {
    throw new UnifiConfigError(
      `Set siteId. Sites: ${sites.map((item) => `${item.name} (${item.id})`).join(", ")}`,
    );
  }
  const [zones, networks] = await Promise.all([client.listZones(site.id), loadNetworkDetails(client, site.id)]);
  void zones;
  return {
    applicationVersion: info.applicationVersion,
    site: { id: site.id, name: site.name },
    siteCount: sites.length,
    networks: networks.map(publicUnifiNetwork),
  };
}

export async function listSiteNetworks(household: Household): Promise<PublicUnifiNetwork[]> {
  if (!household.unifiKeyLastFour || !household.unifiSiteId) return [];
  const client = clientForHousehold(household);
  const networks = await loadNetworkDetails(client, household.unifiSiteId);
  return networks.map(publicUnifiNetwork);
}

export async function saveUnifiConnection(input: {
  apiKey: string;
  baseUrl?: string;
  consoleId?: string;
  siteId?: string;
  tlsInsecure?: boolean;
  manageAllNetworks?: boolean;
  managedNetworkIds?: string[];
}) {
  const probed = await testUnifiConnection(input);
  const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
  const nextIdentity = input.consoleId
    ? `cloud:${input.consoleId}:${probed.site.id}`
    : `local:${input.baseUrl}:${probed.site.id}`;
  const previous = household.unifiSiteId ? connectionIdentity(household) : null;
  if (previous && previous !== nextIdentity && household.unifiKeyCiphertext) {
    try {
      const oldClient = clientForHousehold(household);
      const owned = await prisma().appPolicy.findMany({
        where: { connectionIdentity: previous, siteId: household.unifiSiteId ?? undefined },
      });
      for (const policy of owned) {
        if (policy.unifiPolicyId) await oldClient.deletePolicy(household.unifiSiteId!, policy.unifiPolicyId);
      }
      await prisma().appPolicy.deleteMany({ where: { connectionIdentity: previous } });
    } catch {
      throw new UnifiConfigError(
        "Could not remove FamilyFi policies from the previous UniFi target. The existing connection was left unchanged.",
      );
    }
  }
  const known = new Set(probed.networks.map((network) => network.id));
  const scope = resolveAndValidateScope(input, household, known);
  const secret = encryptSecret(input.apiKey);
  await prisma().household.update({
    where: { id: "default" },
    data: {
      unifiMode: input.consoleId ? "cloud" : "local",
      unifiBaseUrl: input.baseUrl ?? null,
      unifiConsoleId: input.consoleId ?? null,
      unifiSiteId: probed.site.id,
      unifiTlsInsecure: input.tlsInsecure ?? false,
      unifiManageAllNetworks: scope.manageAllNetworks,
      unifiManagedNetworkIds: scope.managedNetworkIds,
      unifiKeyCiphertext: Uint8Array.from(secret.ciphertext),
      unifiKeyIv: Uint8Array.from(secret.iv),
      unifiKeyAuthTag: Uint8Array.from(secret.authTag),
      unifiKeyLastFour: input.apiKey.slice(-4),
      connectionStatus: "connected",
      connectionError: null,
    },
  });
  return enqueueChange("unifi");
}

export async function saveManagedNetworks(input: { manageAllNetworks?: boolean; managedNetworkIds?: string[] }) {
  const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
  if (!household.unifiKeyLastFour) {
    throw new UnifiConfigError("Save a UniFi API key before choosing networks.");
  }
  const networks = await listSiteNetworks(household);
  const scope = resolveAndValidateScope(input, household, new Set(networks.map((network) => network.id)));
  await prisma().household.update({
    where: { id: "default" },
    data: {
      unifiManageAllNetworks: scope.manageAllNetworks,
      unifiManagedNetworkIds: scope.managedNetworkIds,
    },
  });
  return enqueueChange("unifi");
}

function resolveAndValidateScope(
  input: { manageAllNetworks?: boolean; managedNetworkIds?: string[] },
  household: Household,
  knownIds: Set<string>,
): NetworkScope {
  const scope = resolveNetworkScope({
    manageAllNetworks: input.manageAllNetworks,
    managedNetworkIds: input.managedNetworkIds,
    previous: {
      manageAllNetworks: household.unifiManageAllNetworks,
      managedNetworkIds: household.unifiManagedNetworkIds,
    },
  });
  if (!scope.manageAllNetworks) {
    const unknown = scope.managedNetworkIds.filter((id) => !knownIds.has(id));
    if (unknown.length) {
      throw new UnifiConfigError(`Unknown UniFi network id: ${unknown.join(", ")}`);
    }
  }
  return scope;
}

export function publicUnifiSettings(
  household: {
    unifiMode: string | null;
    unifiBaseUrl: string | null;
    unifiConsoleId: string | null;
    unifiSiteId: string | null;
    unifiKeyLastFour: string | null;
    unifiTlsInsecure: boolean;
    unifiManageAllNetworks: boolean;
    unifiManagedNetworkIds: string[];
    connectionStatus: string;
    connectionError: string | null;
  },
  networks: PublicUnifiNetwork[] = [],
) {
  return {
    configured: Boolean(household.unifiKeyLastFour),
    mode: household.unifiMode,
    baseUrl: household.unifiBaseUrl,
    consoleId: household.unifiConsoleId,
    siteId: household.unifiSiteId,
    apiKeyMasked: household.unifiKeyLastFour ? `••••${household.unifiKeyLastFour}` : null,
    tlsInsecure: household.unifiTlsInsecure,
    manageAllNetworks: household.unifiManageAllNetworks,
    managedNetworkIds: household.unifiManagedNetworkIds,
    networks,
    connectionStatus: household.connectionStatus,
    connectionError: household.connectionError,
  };
}
