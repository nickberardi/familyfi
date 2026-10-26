import type { Household, Prisma } from "@prisma/client";
import {
  CHECK_KIND,
  CHECKUP_CHECKS,
  checkupMessage,
  knownCheck,
  openProblemCount,
  runChecks,
  type CheckupCheck,
  type CheckupDetails,
  type CheckupInputs,
  type CheckupState,
  type CheckupWifi,
} from "@/lib/checkup";
import { prisma } from "./db";
import { normalizeMac } from "./mac";
import type { UnifiClient } from "./unifi/client";
import { checkupPolicy, recordedPurposes, unrecordedPolicies } from "./leftover-policies";
import { clientForHousehold, ownershipScope } from "./unifi/connection";
import { loadNetworkClientIds, loadNetworkDetails } from "./unifi/networks";
import { networkInScope } from "./unifi/scope";
import { mapClientsToZones } from "./unifi/mapping";
import type { ClientOverview, FirewallZone, NetworkDetails } from "./unifi/types";
import type { CheckupPolicy } from "@/lib/checkup";

/**
 * The network checkup (`src/lib/checkup.ts` holds the checks): it reads what sync already read, plus
 * the Wi-Fi networks and the firewall policies, and stores what it found as `CheckupFinding` rows. It
 * only reads; nothing it finds changes the gateway, and only an administrator removes a leftover
 * policy it lists (`src/server/leftover-policies.ts`). Sync runs it at most once an interval, and Check now runs it at once.
 */
export const CHECKUP_INTERVAL_MS = 60 * 60_000;

/** What a sync pass already read, so the checkup does not ask the gateway again. */
export type CheckupPreload = {
  zones: FirewallZone[];
  networks: NetworkDetails[];
  clients: ClientOverview[];
  networkClientIds: Map<string, Set<string>>;
};

let running: Promise<void> | null = null;

/** Run the checkup now; a run already going is joined rather than started again. */
export function runCheckup(household: Household, client: UnifiClient = clientForHousehold(household), preload?: CheckupPreload): Promise<void> {
  running ??= checkup(household, client, preload).finally(() => {
    running = null;
  });
  return running;
}

/** After a sync pass: run the checkup when the last run is older than the interval. Never fails the pass. */
export async function checkupAfterSync(household: Household, client: UnifiClient, preload: CheckupPreload, now = new Date()): Promise<void> {
  if (household.checkupRanAt && now.getTime() - household.checkupRanAt.getTime() < CHECKUP_INTERVAL_MS) return;
  try {
    await runCheckup(household, client, preload);
  } catch (error) {
    console.warn("Network checkup failed:", error);
  }
}

async function checkup(household: Household, client: UnifiClient, preload?: CheckupPreload): Promise<void> {
  const siteId = household.unifiSiteId;
  if (!siteId) return;
  const now = new Date();
  let inputs: CheckupInputs;
  try {
    inputs = await readInputs(household, client, siteId, preload);
  } catch (error) {
    // The findings and the time of the last run stay as they were: a failed read says nothing new
    // about the network, and the next sync pass tries again.
    const message = error instanceof Error ? error.message : String(error);
    await prisma().household.update({ where: { id: "default" }, data: { checkupError: message } });
    return;
  }
  const run = runChecks(inputs);
  await prisma().$transaction(async (tx) => {
    const stored = new Map((await tx.checkupFinding.findMany({ select: { key: true, subject: true } })).map((row) => [row.key, row.subject]));
    for (const finding of run.findings) {
      const details = finding.details as Prisma.InputJsonValue;
      // A dismissal lasts until the first change: one that changes back stays shown.
      const changed = stored.has(finding.key) && stored.get(finding.key) !== finding.subject;
      await tx.checkupFinding.upsert({
        where: { key: finding.key },
        create: { key: finding.key, check: finding.check, details, subject: finding.subject, firstSeenAt: now, lastSeenAt: now },
        update: { details, subject: finding.subject, lastSeenAt: now, ...(changed ? { dismissedAt: null, dismissedSubject: null } : {}) },
      });
    }
    // A finding no longer seen goes, except for a check that could not look this time.
    await tx.checkupFinding.deleteMany({
      where: { key: { notIn: run.findings.map((finding) => finding.key) }, check: { notIn: run.skipped } },
    });
    await tx.household.update({ where: { id: "default" }, data: { checkupRanAt: now, checkupError: null, checkupSkipped: run.skipped } });
  });
}

async function readInputs(household: Household, client: UnifiClient, siteId: string, preload?: CheckupPreload): Promise<CheckupInputs> {
  const networks = preload?.networks ?? (await loadNetworkDetails(client, siteId));
  const [zones, clients, networkClientIds] = preload
    ? [preload.zones, preload.clients, preload.networkClientIds]
    : await Promise.all([client.listZones(siteId), client.listClients(siteId), loadNetworkClientIds(client, siteId, networks)]);
  const scope = { manageAllNetworks: household.unifiManageAllNetworks, managedNetworkIds: household.unifiManagedNetworkIds };
  // Which network each client is on, the way sync decides it.
  const onNetwork = new Map<string, number>();
  for (const mapping of mapClientsToZones({ clients, networks, zones, networkClientIds })) {
    if (mapping.networkId) onNetwork.set(mapping.networkId, (onNetwork.get(mapping.networkId) ?? 0) + 1);
  }
  const devices = await prisma().device.findMany({ include: { group: { select: { kind: true } } } });
  const fallbackNetwork = networks.find((network) => network.default)?.id ?? null;
  return {
    devices: devices.map((device) => ({
      mac: normalizeMac(device.mac),
      hostname: device.hostname,
      manufacturer: device.manufacturer,
      connectionType: device.connectionType,
      networkId: device.networkId,
      groupKind: device.assignment === "assigned" && device.group ? device.group.kind : null,
    })),
    networks: networks.map((network) => ({
      id: network.id,
      name: network.name,
      managed: networkInScope(scope, network.id),
      mdnsForwardingEnabled: network.mdnsForwardingEnabled ?? null,
      dnsServers: network.ipv4Configuration?.dhcpConfiguration?.dnsServerIpAddressesOverride ?? [],
      clientCount: onNetwork.get(network.id) ?? 0,
    })),
    wifis: await readWifis(client, siteId, fallbackNetwork),
    unrecordedPolicies: await readUnrecordedPolicies(household, client, siteId, zones),
  };
}

/**
 * The gateway's policies no FamilyFi record claims, read now rather than from the sync pass, whose
 * list is from before it created and removed its own. Null when UniFi would not list them.
 */
async function readUnrecordedPolicies(household: Household, client: UnifiClient, siteId: string, zones: FirewallZone[]): Promise<CheckupPolicy[] | null> {
  try {
    const scope = { connectionIdentity: ownershipScope(household).connectionIdentity, siteId };
    const policies = await client.listPolicies(siteId);
    const purposes = await recordedPurposes(scope, policies);
    return (await unrecordedPolicies(scope, policies)).map((policy) => checkupPolicy(policy, zones, purposes.get(policy.name)));
  } catch (error) {
    console.warn("Firewall policies could not be read for the checkup:", error);
    return null;
  }
}

/** The Wi-Fi networks with their details, or null when UniFi would not list them (an older console). */
async function readWifis(client: UnifiClient, siteId: string, defaultNetworkId: string | null): Promise<CheckupWifi[] | null> {
  try {
    const listed = await client.listWifiBroadcasts(siteId);
    const wifis: CheckupWifi[] = [];
    for (const overview of listed) {
      const wifi = await client.getWifiBroadcast(siteId, overview.id);
      const network = wifi.network ?? overview.network;
      wifis.push({
        id: wifi.id,
        name: wifi.name,
        enabled: wifi.enabled,
        networkId: network?.type === "SPECIFIC" && "networkId" in network ? (network.networkId ?? null) : defaultNetworkId,
        frequenciesGHz: wifi.broadcastingFrequenciesGHz ?? null,
        security: wifi.securityConfiguration?.type ?? "",
        multicastToUnicastConversionEnabled: wifi.multicastToUnicastConversionEnabled === true,
        clientIsolationEnabled: wifi.clientIsolationEnabled === true,
      });
    }
    return wifis;
  } catch (error) {
    console.warn("Wi-Fi networks could not be read for the checkup:", error);
    return null;
  }
}

type FindingRow = { key: string; check: string; details: Prisma.JsonValue; subject: string; firstSeenAt: Date; lastSeenAt: Date; dismissedAt: Date | null; dismissedSubject: string | null };

/** A dismissal holds only while the finding is about what was dismissed. */
const dismissed = (row: Pick<FindingRow, "dismissedAt" | "dismissedSubject" | "subject">) => row.dismissedAt !== null && row.dismissedSubject === row.subject;

/** The checkup as `GET /checkup` returns it. */
export async function checkupState(): Promise<CheckupState> {
  const [household, rows] = await Promise.all([
    prisma().household.findUniqueOrThrow({ where: { id: "default" } }),
    prisma().checkupFinding.findMany({ orderBy: { key: "asc" } }),
  ]);
  const findings = rows
    .filter((row) => knownCheck(row.check))
    .map((row) => ({
      id: row.key,
      check: row.check as CheckupCheck,
      kind: CHECK_KIND[row.check as CheckupCheck],
      details: row.details as CheckupDetails,
      message: checkupMessage({ check: row.check as CheckupCheck, details: row.details as CheckupDetails }),
      firstSeenAt: row.firstSeenAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      dismissed: dismissed(row),
    }))
    // Problems first, in the order the checks are listed.
    .sort((a, b) => Number(a.kind === "note") - Number(b.kind === "note") || CHECKUP_CHECKS.indexOf(a.check) - CHECKUP_CHECKS.indexOf(b.check) || a.id.localeCompare(b.id));
  const found = new Set(findings.map((finding) => finding.check));
  // A run that could not read the network passed nothing.
  const passed = household.checkupRanAt && !household.checkupError ? CHECKUP_CHECKS.filter((check) => !found.has(check) && !household.checkupSkipped.includes(check)) : [];
  return { ranAt: household.checkupRanAt?.toISOString() ?? null, error: household.checkupError, findings, passed };
}

/** The open problems, for the nav badge on `GET /sync`. */
export async function checkupProblemCount(): Promise<number> {
  const rows = await prisma().checkupFinding.findMany({ select: { check: true, subject: true, dismissedAt: true, dismissedSubject: true } });
  return openProblemCount(rows.filter((row) => knownCheck(row.check)).map((row) => ({ kind: CHECK_KIND[row.check as CheckupCheck], dismissed: dismissed(row) })));
}

/** Dismiss a finding, or show it again. Returns false when there is no such finding. */
export async function setFindingDismissed(key: string, value: boolean): Promise<boolean> {
  const row = await prisma().checkupFinding.findUnique({ where: { key } });
  if (!row) return false;
  await prisma().checkupFinding.update({
    where: { key },
    data: value ? { dismissedAt: new Date(), dismissedSubject: row.subject } : { dismissedAt: null, dismissedSubject: null },
  });
  return true;
}
