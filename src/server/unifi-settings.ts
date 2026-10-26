import { encryptSecret } from "./crypto";
import { prisma } from "./db";
import { unifiMockEnabled } from "./env";
import { PreviousTargetError, UnifiConfigError, UnifiHttpError } from "./unifi/errors";
import { clientForHousehold, connectionIdentity, probeClient } from "./unifi/connection";
import { enqueueChange } from "./changes";
import { pruneNetworkScopedRulesForScope } from "./network-rules";
import { publicUnifiNetwork, resolveNetworkScope, type NetworkScope, type PublicUnifiNetwork } from "./unifi/scope";
import { loadNetworkDetails } from "./unifi/networks";
import { forgetDpiCatalogs } from "./unifi/dpi-catalog";
import { settleLostCreates } from "./unifi/lost-creates";
import { recentSiteNetworks, rememberSiteNetworks } from "./unifi/network-cache";
import { PolicyOperationIntent, Prisma, type Household } from "@prisma/client";
import { withReconcileLock } from "./reconciliation";

async function probeWithClient(client: ReturnType<typeof probeClient>, siteId?: string) {
  const [info, sites] = await Promise.all([client.getInfo(), client.listSites()]);
  if (sites.length === 0) throw new UnifiConfigError("UniFi returned no sites.");
  const site = siteId
    ? sites.find((item) => item.id === siteId)
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

export async function testUnifiConnection(input: {
  apiKey: string;
  baseUrl?: string;
  consoleId?: string;
  siteId?: string;
  tlsInsecure?: boolean;
}) {
  return probeWithClient(probeClient(input), input.siteId);
}

export async function testStoredUnifiConnection() {
  const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
  if (!household.unifiKeyLastFour) {
    throw new UnifiConfigError("Save a UniFi API key first.");
  }
  return probeWithClient(clientForHousehold(household), household.unifiSiteId ?? undefined);
}

/**
 * The site's networks, from the last few minutes' reconcile pass when there is one. `fresh`
 * asks the console, for a choice that must be checked against what is there now.
 */
export async function listSiteNetworks(household: Household, options: { fresh?: boolean } = {}): Promise<PublicUnifiNetwork[]> {
  if (!household.unifiKeyLastFour || !household.unifiSiteId) return [];
  const identity = connectionIdentity(household);
  const recent = options.fresh ? null : recentSiteNetworks(identity);
  if (recent) return recent;
  const client = clientForHousehold(household);
  const networks = (await loadNetworkDetails(client, household.unifiSiteId)).map(publicUnifiNetwork);
  rememberSiteNetworks(identity, networks);
  return networks;
}

/**
 * Deletes every policy FamilyFi owns on the console and site it is leaving: quarantine and rule
 * policies, any it created that no record points at any more, and any a lost create made. Nothing sweeps that console
 * once the household points elsewhere, so whatever stays there keeps enforcing. One someone
 * already deleted there counts as removed. The records go only after the gateway deletes, since
 * they are what lets the guarded client delete at all.
 */
async function removePreviousTargetPolicies(household: Household, identity: string, stillHeld: () => void) {
  const siteId = household.unifiSiteId!;
  const scope = { connectionIdentity: identity, siteId };
  const applied = { ...scope, intent: PolicyOperationIntent.create, status: "applied" as const };
  const client = clientForHousehold(household);
  // A create there whose answer was lost may have made a policy too; nothing looks there later.
  const pending = await prisma().policyOperation.count({ where: { ...scope, intent: PolicyOperationIntent.create, status: "pending" } });
  if (pending > 0) await settleLostCreates(scope, await client.listPolicies(siteId), { abandonBefore: new Date(8.64e15) });
  const [appPolicies, rulePolicies, creations] = await Promise.all([
    prisma().appPolicy.findMany({ where: scope, select: { unifiPolicyId: true } }),
    prisma().rulePolicy.findMany({ where: scope, select: { unifiPolicyId: true } }),
    prisma().policyOperation.findMany({ where: applied, select: { unifiPolicyId: true } }),
  ]);
  const owned = new Set([...appPolicies, ...rulePolicies, ...creations].flatMap((row) => row.unifiPolicyId ?? []));
  for (const policyId of owned) {
    stillHeld();
    try {
      await client.deletePolicy(siteId, policyId);
    } catch (error) {
      if (!(error instanceof UnifiHttpError && error.status === 404)) throw error;
    }
  }
  stillHeld();
  await forgetPreviousTarget(identity, siteId);
}

/**
 * Drops every record of the console and site the household is leaving. After a cleanup, nothing
 * is left there to record; when the operator forgets an unreachable one, whatever FamilyFi made
 * there stays, and FamilyFi no longer claims it.
 */
async function forgetPreviousTarget(identity: string, siteId: string) {
  const creations = { connectionIdentity: identity, siteId, intent: PolicyOperationIntent.create };
  await prisma().$transaction([
    prisma().appPolicy.deleteMany({ where: { connectionIdentity: identity } }),
    prisma().rulePolicy.deleteMany({ where: { connectionIdentity: identity } }),
    prisma().policyOperation.updateMany({ where: { ...creations, status: "applied" }, data: { status: "removed" } }),
    prisma().policyOperation.updateMany({ where: { ...creations, status: "pending" }, data: { status: "failed", payload: Prisma.DbNull } }),
  ]);
}

export async function saveUnifiConnection(input: {
  apiKey: string;
  baseUrl?: string;
  consoleId?: string;
  siteId?: string;
  tlsInsecure?: boolean;
  manageAllNetworks?: boolean;
  managedNetworkIds?: string[];
  /** Switch even when the console being left can't be cleaned up, leaving its policies there. */
  forgetPrevious?: boolean;
}) {
  const probed = await testUnifiConnection(input);
  const nextIdentity = input.consoleId
    ? `cloud:${input.consoleId}:${probed.site.id}`
    : `local:${input.baseUrl}:${probed.site.id}`;
  // No pass may write to the console being left, or record a policy there, while it is cleaned up
  // and the household moves.
  const scope = await withReconcileLock((stillHeld) => switchUnifiTarget(input, probed, nextIdentity, stillHeld), {
    busy: () => new UnifiConfigError("A sync with the gateway is still running. Try saving again in a minute."),
  });
  rememberSiteNetworks(nextIdentity, probed.networks);
  // A new key or gateway behind the same address may know other apps.
  forgetDpiCatalogs();
  await pruneNetworkScopedRulesForScope(scope);
  return enqueueChange("unifi");
}

async function switchUnifiTarget(
  input: Parameters<typeof saveUnifiConnection>[0],
  probed: Awaited<ReturnType<typeof testUnifiConnection>>,
  nextIdentity: string,
  stillHeld: () => void,
): Promise<NetworkScope> {
  const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
  const scopedInput =
    unifiMockEnabled() && input.manageAllNetworks === undefined && input.managedNetworkIds === undefined
      ? { ...input, manageAllNetworks: true }
      : input;
  // A choice the new site can't honour is refused before anything on the old one is touched.
  const known = new Set(probed.networks.map((network) => network.id));
  const scope = resolveAndValidateScope(scopedInput, household, known);
  const previous = household.unifiSiteId ? connectionIdentity(household) : null;
  if (previous && previous !== nextIdentity && household.unifiKeyCiphertext) {
    try {
      await removePreviousTargetPolicies(household, previous, stillHeld);
    } catch (error) {
      // A lost lock is not the old gateway's fault, and never a reason to forget it.
      stillHeld();
      console.warn("Could not remove FamilyFi policies from the previous UniFi target:", error);
      if (!input.forgetPrevious) throw new PreviousTargetError();
      await forgetPreviousTarget(previous, household.unifiSiteId!);
    }
  }
  // A cleanup slow enough to lose the lock stops here, before the household moves.
  stillHeld();
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
  return scope;
}

export async function saveManagedNetworks(input: { manageAllNetworks?: boolean; managedNetworkIds?: string[] }) {
  const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
  if (!household.unifiKeyLastFour) {
    throw new UnifiConfigError("Save a UniFi API key before choosing networks.");
  }
  const networks = await listSiteNetworks(household, { fresh: true });
  const scope = resolveAndValidateScope(input, household, new Set(networks.map((network) => network.id)));
  await prisma().household.update({
    where: { id: "default" },
    data: {
      unifiManageAllNetworks: scope.manageAllNetworks,
      unifiManagedNetworkIds: scope.managedNetworkIds,
    },
  });
  // D9/Phase 3: removing a managed network must not leave silent desired-state orphans.
  await pruneNetworkScopedRulesForScope(scope);
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
