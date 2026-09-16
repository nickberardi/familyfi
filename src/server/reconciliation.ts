import { AssignmentState, ChangeStatus, IpVersion, PolicyOperationIntent, PolicyOwnerScope } from "@prisma/client";
import { randomToken } from "./crypto";
import { prisma } from "./db";
import { env } from "./env";
import { normalizeMac } from "./mac";
import { loadNetworkClientIds, loadNetworkDetails } from "./unifi/spike";
import { clientForHousehold, connectionIdentity } from "./unifi/connection";
import { UnifiHttpError } from "./unifi/errors";
import { policyFingerprint } from "./unifi/fingerprint";
import { mapClientsToZones, selectExternalZone } from "./unifi/mapping";
import {
  dpiAppBlockPolicy,
  dpiAppNetworkBlockPolicy,
  dpiCategoryBlockPolicy,
  dpiCategoryNetworkBlockPolicy,
  internetBlockPolicy,
  toPolicyUpdate,
} from "./unifi/payloads";
import { networkInScope } from "./unifi/scope";
import { coverageIssues, isWriteFailure } from "./policy-coverage";
import { planPolicies, plannedKey } from "./unifi/plan";
import { planDpiPolicies, plannedDpiKey, type PlannedDpiPolicy } from "./unifi/plan-dpi";
import type { UnifiClient } from "./unifi/client";
import type { FirewallPolicyWrite } from "./unifi/types";

const INTERVAL_MS = 30_000;
const LOCK_MS = 25_000;

let queued = false;
let pumping = false;
let autoReconcile = true;
let testClient: UnifiClient | undefined;

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
  await prisma().group.updateMany({
    where: { suspensionActive: true, suspensionUntil: { not: null, lte: now } },
    data: { suspensionActive: false, suspensionUntil: null },
  });

  const household = await prisma().household.findUnique({ where: { id: "default" } });
  if (!household || household.connectionStatus === "unconfigured" || !household.unifiSiteId) return true;

  const revision = household.revision;
  const run = await prisma().syncRun.create({
    data: { requestedRevision: revision, status: ChangeStatus.pending },
  });

  try {
    const client = testClient ?? clientForHousehold(household);
    const identity = connectionIdentity(household);
    const siteId = household.unifiSiteId;
    const [zones, networks, clients, info] = await Promise.all([
      client.listZones(siteId),
      loadNetworkDetails(client, siteId),
      client.listClients(siteId),
      client.getInfo(),
    ]);
    void info;
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

    for (const clientRow of clients) {
      if (!clientRow.macAddress) continue;
      const mac = normalizeMac(clientRow.macAddress);
      const mapped = mappingByMac.get(mac);
      const existing = await prisma().device.findUnique({ where: { mac } });
      const zoneId = mapped?.sourceZoneId ?? existing?.zoneId ?? null;
      const networkId = mapped?.networkId ?? existing?.networkId ?? null;
      const seenOnManagedNetwork = networkInScope(scope, mapped?.networkId ?? null);
      if (!existing && !seenOnManagedNetwork) continue;
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
        },
        update: {
          hostname: clientRow.name,
          ip: clientRow.ipAddress,
          networkId: mapped?.networkId ?? existing?.networkId ?? null,
          zoneId: mapped?.sourceZoneId ?? existing?.zoneId ?? null,
          lastSeenAt: now,
        },
      });
    }

    const [groups, devices, appPolicies] = await Promise.all([
      prisma().group.findMany(),
      prisma().device.findMany(),
      prisma().appPolicy.findMany({ where: { connectionIdentity: identity, siteId } }),
    ]);
    const { policies: desired, retainOwners } = planPolicies({
      installId: household.id,
      now,
      destinationZoneId: external.id,
      zoneNames: Object.fromEntries(zones.map((zone) => [zone.id, zone.name])),
      groups,
      devices: devices.map((device) => ({
        ...device,
        inScope: networkInScope(scope, device.networkId),
      })),
      quarantineEnforced: household.quarantineEnforced,
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
        schedule: planned.schedule,
      });
      const fingerprint = policyFingerprint(write);
      const existing = appPolicies.find(
        (row) =>
          plannedKey(row.ownerScope, row.groupId, row.zoneId) === planned.key && row.connectionIdentity === identity,
      );
      try {
        await applyDesiredPolicy(client, siteId, identity, revision, planned, write, fingerprint, existing);
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
      if (retainOwners.has(owner)) continue;
      if (!row.unifiPolicyId) {
        await prisma().appPolicy.delete({ where: { id: row.id } });
        continue;
      }
      try {
        await client.deletePolicy(siteId, row.unifiPolicyId);
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

    const famRules = await prisma().famRule.findMany();
    const famRulePolicies = await prisma().famRulePolicy.findMany({
      where: { connectionIdentity: identity, siteId },
    });
    const { policies: desiredDpi, retainRuleIds, orphanRuleIds } = planDpiPolicies({
      now,
      destinationZoneId: external.id,
      zoneNames: Object.fromEntries(zones.map((zone) => [zone.id, zone.name])),
      groups,
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
      rules: famRules.map((rule) => ({
        ...rule,
        groupId: rule.groupId,
        networkIds: rule.networkIds,
        scope: rule.scope,
      })),
    });
    const desiredDpiKeys = new Set(desiredDpi.map((item) => item.key));

    for (const planned of desiredDpi) {
      const write =
        planned.sourceType === "NETWORK"
          ? planned.kind === "category"
            ? dpiCategoryNetworkBlockPolicy({
                name: planned.name,
                sourceZoneId: planned.zoneId,
                destinationZoneId: planned.destinationZoneId,
                networkIds: planned.networkIds,
                applicationCategoryIds: planned.targetIds,
                enabled: planned.enabled,
                schedule: planned.schedule,
              })
            : dpiAppNetworkBlockPolicy({
                name: planned.name,
                sourceZoneId: planned.zoneId,
                destinationZoneId: planned.destinationZoneId,
                networkIds: planned.networkIds,
                applicationIds: planned.targetIds,
                enabled: planned.enabled,
                schedule: planned.schedule,
              })
          : planned.kind === "category"
            ? dpiCategoryBlockPolicy({
                name: planned.name,
                sourceZoneId: planned.zoneId,
                destinationZoneId: planned.destinationZoneId,
                macAddresses: planned.macAddresses,
                applicationCategoryIds: planned.targetIds,
                enabled: planned.enabled,
                schedule: planned.schedule,
              })
            : dpiAppBlockPolicy({
                name: planned.name,
                sourceZoneId: planned.zoneId,
                destinationZoneId: planned.destinationZoneId,
                macAddresses: planned.macAddresses,
                applicationIds: planned.targetIds,
                enabled: planned.enabled,
                schedule: planned.schedule,
              });
      const fingerprint = policyFingerprint(write);
      const existing = famRulePolicies.find(
        (row) => plannedDpiKey(row.famRuleId, row.zoneId) === planned.key && row.connectionIdentity === identity,
      );
      try {
        await applyDesiredDpiPolicy(client, siteId, identity, revision, planned, write, fingerprint, existing);
      } catch (error) {
        failed += 1;
        errors.push(error instanceof Error ? error.message : String(error));
        if (existing) {
          await prisma().famRulePolicy.update({
            where: { id: existing.id },
            data: { lastError: errors[errors.length - 1], desiredFingerprint: fingerprint, desiredRevision: revision },
          });
        } else {
          await prisma().famRulePolicy.create({
            data: {
              famRuleId: planned.famRuleId,
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

    for (const row of famRulePolicies) {
      const key = plannedDpiKey(row.famRuleId, row.zoneId);
      if (desiredDpiKeys.has(key)) continue;
      if (retainRuleIds.has(row.famRuleId)) continue;
      if (!row.unifiPolicyId) {
        await prisma().famRulePolicy.delete({ where: { id: row.id } });
        continue;
      }
      try {
        // D3: only delete the recorded unifiPolicyId — never adopt by name prefix.
        await client.deletePolicy(siteId, row.unifiPolicyId);
        await prisma().famRulePolicy.delete({ where: { id: row.id } });
      } catch (error) {
        failed += 1;
        errors.push(error instanceof Error ? error.message : String(error));
        await prisma().famRulePolicy.update({
          where: { id: row.id },
          data: { lastError: errors[errors.length - 1] },
        });
      }
    }

    // Sync cleanup: network rules with no remaining managed network ids leave no silent orphans.
    for (const orphanId of orphanRuleIds) {
      const remaining = await prisma().famRulePolicy.count({ where: { famRuleId: orphanId } });
      if (remaining === 0) {
        await prisma().famRule.delete({ where: { id: orphanId } }).catch(() => undefined);
      }
    }

    const livePolicies = await prisma().appPolicy.findMany({ where: { connectionIdentity: identity, siteId } });
    const issues = coverageIssues({
      groups,
      devices: devices.map((device) => ({
        ...device,
        inScope: networkInScope(scope, device.networkId),
      })),
      policies: livePolicies,
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
) {
  const scope = planned.ownerScope === "group" ? PolicyOwnerScope.group : PolicyOwnerScope.quarantine;
  const appPolicyId = existing?.id;
  const unifiPolicyId = existing?.unifiPolicyId;
  if (existing && unifiPolicyId && existing.desiredFingerprint === fingerprint && !existing.lastError) {
    await prisma().appPolicy.update({
      where: { id: existing.id },
      data: { desiredRevision: revision, observedFingerprint: fingerprint, lastError: null },
    });
    return;
  }
  if (unifiPolicyId) {
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


async function applyDesiredDpiPolicy(
  client: UnifiClient,
  siteId: string,
  identity: string,
  revision: number,
  planned: PlannedDpiPolicy,
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
) {
  const unifiPolicyId = existing?.unifiPolicyId;
  if (existing && unifiPolicyId && existing.desiredFingerprint === fingerprint && !existing.lastError) {
    await prisma().famRulePolicy.update({
      where: { id: existing.id },
      data: { desiredRevision: revision, observedFingerprint: fingerprint, lastError: null },
    });
    return;
  }
  if (unifiPolicyId) {
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
        await prisma().famRulePolicy.update({ where: { id: existing.id }, data: observed });
      } else {
        await prisma().famRulePolicy.create({
          data: {
            famRuleId: planned.famRuleId,
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
  await prisma().policyOperation.update({
    where: { id: operation.id },
    data: { status: "applied", unifiPolicyId: created.id },
  });
  if (existing) {
    await prisma().famRulePolicy.update({
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
  await prisma().famRulePolicy.create({
    data: {
      famRuleId: planned.famRuleId,
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
  timer.unref?.();
}
