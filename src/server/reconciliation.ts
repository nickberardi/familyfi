import { AssignmentState, ChangeStatus, IpVersion, PolicyOperationIntent, PolicyOwnerScope } from "@prisma/client";
import { QUARANTINE_RULE_ID } from "@/lib/rules";
import { isSuspended } from "@/lib/schedule";
import { randomToken } from "./crypto";
import { prisma } from "./db";
import { env } from "./env";
import { normalizeMac } from "./mac";
import { macRegistrants } from "./mac-vendor";
import { loadNetworkClientIds, loadNetworkDetails } from "./unifi/networks";
import { clientForHousehold, connectionIdentity, ownershipScope } from "./unifi/connection";
import { withPolicyOwnership } from "./unifi/policy-ownership";
import { UnifiHttpError } from "./unifi/errors";
import { policyFingerprint } from "./unifi/fingerprint";
import { mapClientsToZones, selectExternalZone } from "./unifi/mapping";
import { internetBlockPolicy, toPolicyUpdate } from "./unifi/payloads";
import { networkInScope } from "./unifi/scope";
import { isWriteFailure, storedCoverage } from "./policy-coverage";
import { planPolicies, plannedKey } from "./unifi/plan";
import { planRulePolicies, plannedRuleKey, rulePolicyWrite, type PlannedRulePolicy } from "./unifi/plan-rules";
import type { UnifiClient } from "./unifi/client";
import type { FirewallPolicyWrite } from "./unifi/types";
import { unrefTimer } from "./unref-timer";

const INTERVAL_MS = 30_000;
const LOCK_MS = 25_000;

let queued = false;
let pumping = false;
let autoReconcile = true;
let testClient: UnifiClient | undefined;
let registrantWarning = false;

/** The IEEE registrant for this pass, or the last recorded one when the registry cannot be read. */
function recordedManufacturer(mac: string, previous: string | null): string | null {
  try {
    return macRegistrants().forMac(mac);
  } catch (error) {
    if (!registrantWarning) console.warn("MAC registrant database unavailable:", error);
    registrantWarning = true;
    return previous;
  }
}

export function setReconcileClientForTests(client?: UnifiClient) {
  testClient = client;
}

export function setAutoReconcileForTests(enabled: boolean) {
  autoReconcile = enabled;
}

export function requestReconcile() {
  if (!autoReconcile) return;
  queued = true;
  void pump();
}

/** Run one locked reconciliation pass. Used by integration tests. */
export async function runReconcileOnce(): Promise<boolean> {
  const owner = `${process.pid}:${randomToken(8)}`;
  return tick(owner);
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queued) {
      queued = false;
      const owner = `${process.pid}:${randomToken(8)}`;
      try {
        const ran = await tick(owner);
        if (!ran) {
          queued = true;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch {
        queued = true;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  } finally {
    pumping = false;
    if (queued) void pump();
  }
}

async function acquireLock(owner: string): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_MS);
  const existing = await prisma().reconciliationLock.findUnique({ where: { id: "global" } });
  if (!existing) {
    try {
      await prisma().reconciliationLock.create({ data: { id: "global", owner, expiresAt } });
      return true;
    } catch {
      return false;
    }
  }
  if (existing.owner !== owner && existing.expiresAt > now) return false;
  const updated = await prisma().reconciliationLock.updateMany({
    where: { id: "global", OR: [{ owner }, { expiresAt: { lte: now } }] },
    data: { owner, expiresAt },
  });
  return updated.count === 1;
}

async function releaseLock(owner: string) {
  await prisma().reconciliationLock.updateMany({
    where: { id: "global", owner },
    data: { expiresAt: new Date(0) },
  });
}

async function tick(owner: string): Promise<boolean> {
  if (!(await acquireLock(owner))) return false;
  try {
  const now = new Date();
  // A group's own pause ends: its built-in block rule is switched off, and its policies go.
  await prisma().rule.updateMany({
    where: { systemGroupId: { not: null }, enabled: true, expiresAt: { not: null, lte: now } },
    data: { enabled: false, expiresAt: null, blockedByAccountId: null, blockedByName: null },
  });
  await prisma().rule.updateMany({
    where: { pauseActive: true, pauseUntil: { not: null, lte: now } },
    data: { pauseActive: false, pauseUntil: null, pausedByAccountId: null, pausedByName: null },
  });
  await prisma().ruleGroup.updateMany({
    where: { pauseActive: true, pauseUntil: { not: null, lte: now } },
    data: { pauseActive: false, pauseUntil: null, pausedByAccountId: null, pausedByName: null },
  });

  const household = await prisma().household.findUnique({ where: { id: "default" } });
  if (!household || household.connectionStatus === "unconfigured" || !household.unifiSiteId) return true;

  const revision = household.revision;
  const run = await prisma().syncRun.create({
    data: { requestedRevision: revision, status: ChangeStatus.pending },
  });

  try {
    // Tests inject a fixture client; it gets the same ownership guard as the real one.
    const client = testClient ? withPolicyOwnership(testClient, ownershipScope(household)) : clientForHousehold(household);
    const identity = connectionIdentity(household);
    const siteId = household.unifiSiteId;
    const [zones, networks, clients, info, gatewayPolicies] = await Promise.all([
      client.listZones(siteId),
      loadNetworkDetails(client, siteId),
      client.listClients(siteId),
      client.getInfo(),
      client.listPolicies(siteId),
    ]);
    // What the gateway holds right now, kept current as this pass creates and deletes, so a
    // policy someone removed on the console is noticed even when nothing else changed.
    const onGateway = new Set(gatewayPolicies.map((policy) => policy.id));
    void info;
    let accessPoints: Map<string, string> | null = null;
    try {
      const siteDevices = await client.listSiteDevices(siteId);
      accessPoints = new Map(siteDevices.map((device) => [device.id, device.name]));
    } catch (error) {
      // Presence remains useful if UniFi cannot name the access points on this pass.
      console.warn("UniFi access point lookup failed:", error);
    }
    const networkClientIds = await loadNetworkClientIds(client, siteId, networks);
    const mappings = mapClientsToZones({ clients, networks, zones, networkClientIds });
    const mappingByMac = new Map(
      mappings.filter((item) => item.macAddress).map((item) => [item.macAddress, item]),
    );
    const external = selectExternalZone(zones);
    if (!external) throw new Error("No External/WAN firewall zone was found.");
    const scope = {
      manageAllNetworks: household.unifiManageAllNetworks,
      managedNetworkIds: household.unifiManagedNetworkIds,
    };

    const observedMacs = new Set<string>();
    for (const clientRow of clients) {
      if (!clientRow.macAddress) continue;
      const mac = normalizeMac(clientRow.macAddress);
      observedMacs.add(mac);
      const mapped = mappingByMac.get(mac);
      const existing = await prisma().device.findUnique({ where: { mac } });
      const zoneId = mapped?.sourceZoneId ?? existing?.zoneId ?? null;
      const networkId = mapped?.networkId ?? existing?.networkId ?? null;
      const seenOnManagedNetwork = networkInScope(scope, mapped?.networkId ?? null);
      if (!existing && !seenOnManagedNetwork) continue;
      const connectionType = ["WIRED", "WIRELESS", "VPN", "TELEPORT"].includes(clientRow.type)
        ? clientRow.type.toLowerCase()
        : null;
      const connectedAt = clientRow.connectedAt && !Number.isNaN(Date.parse(clientRow.connectedAt))
        ? new Date(clientRow.connectedAt)
        : null;
      const accessPointName = connectionType === "wireless" && clientRow.uplinkDeviceId
        ? accessPoints === null
          ? existing?.accessPointName ?? null
          : accessPoints.get(clientRow.uplinkDeviceId) ?? null
        : null;
      const manufacturer = recordedManufacturer(mac, existing?.manufacturer ?? null);
      await prisma().device.upsert({
        where: { mac },
        create: {
          mac,
          hostname: clientRow.name,
          ip: clientRow.ipAddress,
          networkId,
          zoneId,
          assignment: AssignmentState.quarantined,
          lastSeenAt: now,
          presenceOnline: true,
          presenceCheckedAt: now,
          connectedAt,
          connectionType,
          accessPointName,
          manufacturer,
        },
        update: {
          hostname: clientRow.name,
          ip: clientRow.ipAddress,
          networkId: mapped?.networkId ?? existing?.networkId ?? null,
          zoneId: mapped?.sourceZoneId ?? existing?.zoneId ?? null,
          lastSeenAt: now,
          presenceOnline: true,
          presenceCheckedAt: now,
          connectedAt,
          connectionType,
          accessPointName,
          manufacturer,
        },
      });
    }
    await prisma().device.updateMany({
      where: { mac: { notIn: [...observedMacs] } },
      data: {
        presenceOnline: false,
        presenceCheckedAt: now,
        connectedAt: null,
        connectionType: null,
        accessPointName: null,
      },
    });

    const [groups, devices, appPolicies, quarantineRule] = await Promise.all([
      prisma().group.findMany(),
      prisma().device.findMany(),
      prisma().appPolicy.findMany({ where: { connectionIdentity: identity, siteId } }),
      prisma().rule.findUnique({ where: { id: QUARANTINE_RULE_ID } }),
    ]);
    // A pause on the built-in quarantine rule disables its policies, which keep their devices.
    const quarantinePaused = quarantineRule ? isSuspended({ active: quarantineRule.pauseActive, until: quarantineRule.pauseUntil }, now) : false;
    const { policies: desired, retainOwners } = planPolicies({
      installId: household.id,
      destinationZoneId: external.id,
      zoneNames: Object.fromEntries(zones.map((zone) => [zone.id, zone.name])),
      groups,
      devices: devices.map((device) => ({
        ...device,
        inScope: networkInScope(scope, device.networkId),
      })),
      quarantineEnforced: household.quarantineEnforced && !quarantinePaused,
    });
    const desiredKeys = new Set(desired.map((item) => item.key));

    let failed = 0;
    const errors: string[] = [];

    for (const planned of desired) {
      const write = internetBlockPolicy({
        name: planned.name,
        sourceZoneId: planned.zoneId,
        destinationZoneId: planned.destinationZoneId,
        macAddresses: planned.macAddresses,
        enabled: planned.enabled,
      });
      const fingerprint = policyFingerprint(write);
      const existing = appPolicies.find(
        (row) =>
          plannedKey(row.ownerScope, row.groupId, row.zoneId) === planned.key && row.connectionIdentity === identity,
      );
      try {
        await applyDesiredPolicy(client, siteId, identity, revision, planned, write, fingerprint, existing, onGateway);
      } catch (error) {
        failed += 1;
        errors.push(error instanceof Error ? error.message : String(error));
        if (existing) {
          await prisma().appPolicy.update({
            where: { id: existing.id },
            data: { lastError: errors[errors.length - 1], desiredFingerprint: fingerprint, desiredRevision: revision },
          });
        } else {
          await prisma().appPolicy.create({
            data: {
              connectionIdentity: identity,
              siteId,
              ownerScope: planned.ownerScope === "group" ? PolicyOwnerScope.group : PolicyOwnerScope.quarantine,
              groupId: planned.groupId,
              zoneId: planned.zoneId,
              ipVersion: IpVersion.dual,
              desiredFingerprint: fingerprint,
              desiredRevision: revision,
              lastError: errors[errors.length - 1],
            },
          });
        }
      }
    }

    for (const row of appPolicies) {
      const key = plannedKey(row.ownerScope, row.groupId, row.zoneId);
      if (desiredKeys.has(key)) continue;
      const owner = row.ownerScope === PolicyOwnerScope.quarantine ? "quarantine" : `group:${row.groupId}`;
      // Kept while its devices are out of view, unless the console already removed it.
      if (retainOwners.has(owner) && !goneFromGateway(row.unifiPolicyId, onGateway)) continue;
      if (!row.unifiPolicyId) {
        await prisma().appPolicy.delete({ where: { id: row.id } });
        continue;
      }
      try {
        await deleteFromGateway(client, siteId, row.unifiPolicyId, onGateway);
        await prisma().appPolicy.delete({ where: { id: row.id } });
      } catch (error) {
        failed += 1;
        errors.push(error instanceof Error ? error.message : String(error));
        await prisma().appPolicy.update({
          where: { id: row.id },
          data: { lastError: errors[errors.length - 1] },
        });
      }
    }

    // The built-in quarantine rule is enforced by the quarantine policies above, never its own.
    const rules = await prisma().rule.findMany({ where: { id: { not: QUARANTINE_RULE_ID } }, include: { groups: true, windows: true } });
    const rulePolicies = await prisma().rulePolicy.findMany({
      where: { connectionIdentity: identity, siteId },
    });
    const { policies: desiredRules, retainRuleIds, orphanRuleIds } = planRulePolicies({
      destinationZoneId: external.id,
      zoneNames: Object.fromEntries(zones.map((zone) => [zone.id, zone.name])),
      groups: groups.map((group) => ({
        id: group.id,
        kind: group.kind,
      })),
      devices: devices.map((device) => ({
        ...device,
        inScope: networkInScope(scope, device.networkId),
      })),
      networks: networks.map((network) => ({
        id: network.id,
        name: network.name,
        zoneId: network.zoneId ?? null,
      })),
      networkScope: scope,
      rules: rules.map((rule) => ({
        ...rule,
        groupIds: rule.groups.map((link) => link.groupId),
        paused: isSuspended({ active: rule.pauseActive, until: rule.pauseUntil }, now),
        system: rule.systemGroupId !== null,
        liftedGroupIds: rule.groups
          .filter((link) => isSuspended({ active: link.pauseActive, until: link.pauseUntil }, now))
          .map((link) => link.groupId),
      })),
    });
    const desiredRuleKeys = new Set(desiredRules.map((item) => item.key));

    for (const planned of desiredRules) {
      const write = rulePolicyWrite(planned);
      const fingerprint = policyFingerprint(write);
      const existing = rulePolicies.find(
        (row) => plannedRuleKey(row.ruleId, row.windowKey, row.zoneId) === planned.key && row.connectionIdentity === identity,
      );
      try {
        await applyDesiredRulePolicy(client, siteId, identity, revision, planned, write, fingerprint, existing, onGateway);
      } catch (error) {
        failed += 1;
        errors.push(error instanceof Error ? error.message : String(error));
        if (existing) {
          await prisma().rulePolicy.update({
            where: { id: existing.id },
            data: { lastError: errors[errors.length - 1], desiredFingerprint: fingerprint, desiredRevision: revision },
          });
        } else {
          await prisma().rulePolicy.create({
            data: {
              ruleId: planned.ruleId,
              windowKey: planned.windowKey,
              connectionIdentity: identity,
              siteId,
              zoneId: planned.zoneId,
              ipVersion: IpVersion.dual,
              desiredFingerprint: fingerprint,
              desiredRevision: revision,
              lastError: errors[errors.length - 1],
            },
          });
        }
      }
    }

    for (const row of rulePolicies) {
      const key = plannedRuleKey(row.ruleId, row.windowKey, row.zoneId);
      if (desiredRuleKeys.has(key)) continue;
      if (retainRuleIds.has(row.ruleId) && !goneFromGateway(row.unifiPolicyId, onGateway)) continue;
      if (!row.unifiPolicyId) {
        await prisma().rulePolicy.delete({ where: { id: row.id } });
        continue;
      }
      try {
        // D3: only delete the recorded unifiPolicyId — never adopt by name prefix.
        await deleteFromGateway(client, siteId, row.unifiPolicyId, onGateway);
        await prisma().rulePolicy.delete({ where: { id: row.id } });
      } catch (error) {
        failed += 1;
        errors.push(error instanceof Error ? error.message : String(error));
        await prisma().rulePolicy.update({
          where: { id: row.id },
          data: { lastError: errors[errors.length - 1] },
        });
      }
    }

    // Sync cleanup: network rules with no remaining managed network ids leave no silent orphans.
    for (const orphanId of orphanRuleIds) {
      const remaining = await prisma().rulePolicy.count({ where: { ruleId: orphanId } });
      if (remaining === 0) {
        await prisma().rule.delete({ where: { id: orphanId } }).catch(() => undefined);
      }
    }

    const orphanErrors = await removeOrphanedPolicies(client, siteId, identity, onGateway);
    failed += orphanErrors.length;
    errors.push(...orphanErrors);

    const { issues } = await storedCoverage({
      now,
      deviceInScope: (networkId) => networkInScope(scope, networkId),
      policyScope: { connectionIdentity: identity, siteId },
    });
    for (const issue of issues.filter(isWriteFailure)) {
      failed += 1;
      errors.push(issue.message);
    }

    const status = failed === 0 ? ChangeStatus.applied : ChangeStatus.partial;
    await prisma().syncRun.update({
      where: { id: run.id },
      data: {
        status,
        appliedRevision: revision,
        finishedAt: new Date(),
        error: errors[0],
      },
    });
    // The pass reached the gateway, so an error left by an earlier failed pass no longer holds.
    await prisma().household.updateMany({
      where: { id: "default", connectionStatus: "error" },
      data: { connectionStatus: "connected", connectionError: null },
    });
    await prisma().changeResult.updateMany({
      where: { status: ChangeStatus.pending, requestedRevision: { lte: revision } },
      data: {
        status,
        appliedRevision: revision,
        error: errors[0],
        syncRunId: run.id,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma().syncRun.update({
      where: { id: run.id },
      data: { status: ChangeStatus.failed, finishedAt: new Date(), error: message },
    });
    await prisma().household.update({
      where: { id: "default" },
      data: { connectionStatus: "error", connectionError: message },
    });
    await prisma().changeResult.updateMany({
      where: { status: ChangeStatus.pending, requestedRevision: { lte: revision } },
      data: { status: ChangeStatus.failed, error: message, syncRunId: run.id },
    });
  }
  return true;
  } finally {
    await releaseLock(owner);
  }
}

async function applyDesiredPolicy(
  client: UnifiClient,
  siteId: string,
  identity: string,
  revision: number,
  planned: { ownerScope: "group" | "quarantine"; groupId: string | null; zoneId: string; name: string },
  write: FirewallPolicyWrite,
  fingerprint: string,
  existing:
    | {
        id: string;
        unifiPolicyId: string | null;
        desiredFingerprint: string;
        lastError: string | null;
      }
    | undefined,
  onGateway: Set<string>,
) {
  const scope = planned.ownerScope === "group" ? PolicyOwnerScope.group : PolicyOwnerScope.quarantine;
  const appPolicyId = existing?.id;
  const unifiPolicyId = existing?.unifiPolicyId;
  // Unchanged and still on the gateway: nothing to write. A policy removed on the console
  // falls through and is created again below.
  if (
    existing &&
    unifiPolicyId &&
    onGateway.has(unifiPolicyId) &&
    existing.desiredFingerprint === fingerprint &&
    !existing.lastError
  ) {
    await prisma().appPolicy.update({
      where: { id: existing.id },
      data: { desiredRevision: revision, observedFingerprint: fingerprint, lastError: null },
    });
    return;
  }
  if (unifiPolicyId && onGateway.has(unifiPolicyId)) {
    try {
      const current = await client.getPolicy(siteId, unifiPolicyId);
      const updated = await client.updatePolicy(siteId, unifiPolicyId, toPolicyUpdate(current, { ...write, schedule: write.schedule ?? null }));
      const observed = {
        unifiPolicyId: updated.id,
        desiredFingerprint: fingerprint,
        desiredRevision: revision,
        observedEnabled: updated.enabled,
        observedFingerprint: fingerprint,
        lastError: null as string | null,
      };
      if (appPolicyId) {
        await prisma().appPolicy.update({ where: { id: appPolicyId }, data: observed });
      } else {
        await prisma().appPolicy.create({
          data: {
            connectionIdentity: identity,
            siteId,
            ownerScope: scope,
            groupId: planned.groupId,
            zoneId: planned.zoneId,
            ipVersion: IpVersion.dual,
            ...observed,
          },
        });
      }
      return;
    } catch (error) {
      if (!(error instanceof UnifiHttpError) || error.status !== 404) throw error;
    }
  }

  const operation = await prisma().policyOperation.create({
    data: {
      intent: PolicyOperationIntent.create,
      connectionIdentity: identity,
      siteId,
      payloadFingerprint: fingerprint,
      status: "pending",
    },
  });
  const created = await client.createPolicy(siteId, write);
  onGateway.add(created.id);
  await prisma().policyOperation.update({
    where: { id: operation.id },
    data: { status: "applied", unifiPolicyId: created.id },
  });
  if (appPolicyId) {
    await prisma().appPolicy.update({
      where: { id: appPolicyId },
      data: {
        unifiPolicyId: created.id,
        desiredFingerprint: fingerprint,
        desiredRevision: revision,
        observedEnabled: created.enabled,
        observedFingerprint: fingerprint,
        lastError: null,
      },
    });
    return;
  }
  await prisma().appPolicy.create({
    data: {
      connectionIdentity: identity,
      siteId,
      unifiPolicyId: created.id,
      ownerScope: scope,
      groupId: planned.groupId,
      zoneId: planned.zoneId,
      ipVersion: IpVersion.dual,
      desiredFingerprint: fingerprint,
      desiredRevision: revision,
      observedEnabled: created.enabled,
      observedFingerprint: fingerprint,
    },
  });
}


async function applyDesiredRulePolicy(
  client: UnifiClient,
  siteId: string,
  identity: string,
  revision: number,
  planned: PlannedRulePolicy,
  write: FirewallPolicyWrite,
  fingerprint: string,
  existing:
    | {
        id: string;
        unifiPolicyId: string | null;
        desiredFingerprint: string;
        lastError: string | null;
      }
    | undefined,
  onGateway: Set<string>,
) {
  const unifiPolicyId = existing?.unifiPolicyId;
  // Unchanged and still on the gateway: nothing to write. A policy removed on the console
  // falls through and is created again below.
  if (
    existing &&
    unifiPolicyId &&
    onGateway.has(unifiPolicyId) &&
    existing.desiredFingerprint === fingerprint &&
    !existing.lastError
  ) {
    await prisma().rulePolicy.update({
      where: { id: existing.id },
      data: { desiredRevision: revision, observedFingerprint: fingerprint, lastError: null },
    });
    return;
  }
  if (unifiPolicyId && onGateway.has(unifiPolicyId)) {
    try {
      // D3: update only the recorded id — never search/adopt by FamilyFi name prefix.
      const current = await client.getPolicy(siteId, unifiPolicyId);
      const updated = await client.updatePolicy(
        siteId,
        unifiPolicyId,
        toPolicyUpdate(current, { ...write, schedule: write.schedule ?? null }),
      );
      const observed = {
        unifiPolicyId: updated.id,
        desiredFingerprint: fingerprint,
        desiredRevision: revision,
        observedEnabled: updated.enabled,
        observedFingerprint: fingerprint,
        lastError: null as string | null,
      };
      if (existing) {
        await prisma().rulePolicy.update({ where: { id: existing.id }, data: observed });
      } else {
        await prisma().rulePolicy.create({
          data: {
            ruleId: planned.ruleId,
            windowKey: planned.windowKey,
            connectionIdentity: identity,
            siteId,
            zoneId: planned.zoneId,
            ipVersion: IpVersion.dual,
            ...observed,
          },
        });
      }
      return;
    } catch (error) {
      if (!(error instanceof UnifiHttpError) || error.status !== 404) throw error;
    }
  }

  const operation = await prisma().policyOperation.create({
    data: {
      intent: PolicyOperationIntent.create,
      connectionIdentity: identity,
      siteId,
      payloadFingerprint: fingerprint,
      status: "pending",
    },
  });
  const created = await client.createPolicy(siteId, write);
  onGateway.add(created.id);
  await prisma().policyOperation.update({
    where: { id: operation.id },
    data: { status: "applied", unifiPolicyId: created.id },
  });
  if (existing) {
    await prisma().rulePolicy.update({
      where: { id: existing.id },
      data: {
        unifiPolicyId: created.id,
        desiredFingerprint: fingerprint,
        desiredRevision: revision,
        observedEnabled: created.enabled,
        observedFingerprint: fingerprint,
        lastError: null,
      },
    });
    return;
  }
  await prisma().rulePolicy.create({
    data: {
      ruleId: planned.ruleId,
      windowKey: planned.windowKey,
      connectionIdentity: identity,
      siteId,
      unifiPolicyId: created.id,
      zoneId: planned.zoneId,
      ipVersion: IpVersion.dual,
      desiredFingerprint: fingerprint,
      desiredRevision: revision,
      observedEnabled: created.enabled,
      observedFingerprint: fingerprint,
    },
  });
}

export function startReconciliation() {
  env();
  requestReconcile();
  const timer = setInterval(() => requestReconcile(), INTERVAL_MS);
  unrefTimer(timer);
}

function isNotFound(error: unknown): boolean {
  return error instanceof UnifiHttpError && error.status === 404;
}

/** A record whose policy is no longer on the gateway: there is nothing left to keep. */
function goneFromGateway(unifiPolicyId: string | null, onGateway: Set<string>): boolean {
  return Boolean(unifiPolicyId) && !onGateway.has(unifiPolicyId!);
}

/** Deletes a policy FamilyFi owns. One already gone from the gateway counts as deleted. */
async function deleteFromGateway(client: UnifiClient, siteId: string, policyId: string, onGateway: Set<string>) {
  if (onGateway.has(policyId)) {
    try {
      await client.deletePolicy(siteId, policyId);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
  onGateway.delete(policyId);
}

/**
 * Deletes policies FamilyFi created on this console and site that no ownership record
 * points at any more. A rule, group or console change drops its records even when the
 * UniFi delete failed, which used to leave the policy enforcing on the gateway with
 * nothing to clean it up. The creation record is the evidence it is ours, never its name.
 */
async function removeOrphanedPolicies(
  client: UnifiClient,
  siteId: string,
  identity: string,
  onGateway: Set<string>,
): Promise<string[]> {
  const scope = { connectionIdentity: identity, siteId };
  const [appPolicies, rulePolicies, creations] = await Promise.all([
    prisma().appPolicy.findMany({ where: scope, select: { unifiPolicyId: true } }),
    prisma().rulePolicy.findMany({ where: scope, select: { unifiPolicyId: true } }),
    prisma().policyOperation.findMany({
      where: { ...scope, intent: PolicyOperationIntent.create, status: "applied", unifiPolicyId: { not: null } },
    }),
  ]);
  const recorded = new Set([...appPolicies, ...rulePolicies].map((row) => row.unifiPolicyId));
  const errors: string[] = [];
  for (const creation of creations) {
    const policyId = creation.unifiPolicyId!;
    if (recorded.has(policyId)) continue;
    try {
      await deleteFromGateway(client, siteId, policyId, onGateway);
      // Gone from the gateway and from the records: no longer evidence of anything.
      await prisma().policyOperation.update({ where: { id: creation.id }, data: { status: "removed" } });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return errors;
}
