#!/usr/bin/env node
import { HttpUnifiClient } from "../../src/server/unifi/client";
import { UnifiConfigError } from "../../src/server/unifi/errors";
import { orderedPolicyIds, relativeOrderPreserved } from "../../src/server/unifi/ordering";
import { sanitizeUnifiValue } from "../../src/server/unifi/sanitize";
import {
  applyInternetBlocks,
  deletePolicies,
  discoverInventory,
  ownedSpikePolicies,
  setPoliciesEnabled,
} from "../../src/server/unifi/spike";
import { UNIFI_API_VERSION } from "../../src/server/unifi/types";
import { normalizeMac } from "../../src/server/mac";
import { clearSpikeState, readSpikeState, writeSpikeState } from "./state";

function help(): string {
  return `FamilyFi UniFi spike (official Network Integration API ${UNIFI_API_VERSION})

This CLI talks to UniFi. It does not store keys in PostgreSQL.
API success is not client proof. After apply/disable, check internet and LAN
on the test device itself (see docs/spike/OPERATOR.md).

Credentials (CLI-only):
  UNIFI_API_KEY                 operator-created UniFi key
  UNIFI_BASE_URL                https://<console-ip>/proxy/network/integration
  or UNIFI_CONSOLE_ID           cloud connector console id
  UNIFI_SITE_ID                 required when the console has more than one site
  UNIFI_SPIKE_MACS              comma-separated test MACs
  UNIFI_SPIKE_INSTALL_ID        default local (legacy spike name matching)
  UNIFI_TLS_INSECURE=1          local consoles with a private CA
  UNIFI_SPIKE_CONFIRM=1         required for apply and cleanup

Commands:
  discover    list sites, zones, networks, clients (local stdout)
  snapshot    print policy names and ordering ids
  apply       create BLOCK policies for UNIFI_SPIKE_MACS toward External
  disable     PUT enabled=false on spike-created policies
  enable      PUT enabled=true on spike-created policies
  cleanup     delete spike-created policies and compare admin order
  status      show recorded spike policy ids

Never commit keys, .live-state.json, or unsanitized household dumps.
API success is not client proof; confirm internet and LAN on the test device.
`;
}

function envFlag(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function requireConfirm(command: string): void {
  if (envFlag("UNIFI_SPIKE_CONFIRM") || process.argv.includes("--yes")) return;
  console.error(`Refusing ${command} without UNIFI_SPIKE_CONFIRM=1 (or --yes).`);
  process.exit(2);
}

function parseMacs(): string[] {
  const fromEnv = process.env.UNIFI_SPIKE_MACS ?? "";
  const fromArg = flagValue("--mac") ?? "";
  const raw = [fromEnv, fromArg].join(",");
  const macs = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(normalizeMac);
  return [...new Set(macs)];
}

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function createClient(): HttpUnifiClient {
  const apiKey = process.env.UNIFI_API_KEY?.trim();
  if (!apiKey) {
    throw new UnifiConfigError("Set UNIFI_API_KEY and either UNIFI_BASE_URL or UNIFI_CONSOLE_ID.");
  }
  if (envFlag("UNIFI_TLS_INSECURE")) {
    // Spike process only. Local consoles often present a private CA.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
  return new HttpUnifiClient({
    apiKey,
    baseUrl: process.env.UNIFI_BASE_URL,
    consoleId: process.env.UNIFI_CONSOLE_ID,
  });
}

function printJson(value: unknown): void {
  const payload = envFlag("UNIFI_SPIKE_SANITIZE") ? sanitizeUnifiValue(value) : value;
  if (!envFlag("UNIFI_SPIKE_SANITIZE")) {
    console.error("Do not commit this output. It may contain household MACs, names, and IPs.");
  }
  console.log(JSON.stringify(payload, null, 2));
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2).filter((arg) => arg !== "--");
  const command = argv[0] ?? "help";
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(help());
    const key = process.env.UNIFI_API_KEY?.trim();
    const target = process.env.UNIFI_BASE_URL || process.env.UNIFI_CONSOLE_ID;
    if (!key || !target) return 2;
    return 0;
  }

  const client = createClient();
  const installId = process.env.UNIFI_SPIKE_INSTALL_ID?.trim() || "local";
  const siteId = process.env.UNIFI_SITE_ID?.trim() || flagValue("--site");

  if (command === "discover") {
    const inventory = await discoverInventory(client, siteId);
    printJson({
      api: UNIFI_API_VERSION,
      applicationVersion: inventory.applicationVersion,
      connection: process.env.UNIFI_CONSOLE_ID ? "cloud" : "local",
      site: inventory.site,
      externalZone: { id: inventory.externalZone.id, name: inventory.externalZone.name },
      zones: inventory.zones.map((zone) => ({ id: zone.id, name: zone.name, networkIds: zone.networkIds })),
      networks: inventory.networks.map((network) => ({
        id: network.id,
        name: network.name,
        vlanId: network.vlanId,
        zoneId: network.zoneId,
        prefixLength: network.ipv4Configuration?.prefixLength,
      })),
      clients: inventory.clients.map((item, index) => ({
        id: item.id,
        type: item.type,
        mapping: inventory.mappings[index],
      })),
      mappingNote:
        "Official client overview/details do not include networkId. Mapping uses network references and IPv4 subnets from network details, then zone.networkIds / network.zoneId.",
    });
    return 0;
  }

  if (command === "snapshot") {
    const inventory = await discoverInventory(client, siteId);
    printJson({
      applicationVersion: inventory.applicationVersion,
      policyCount: inventory.policies.length,
      policies: inventory.policies.map((policy) => ({
        id: policy.id,
        name: policy.name,
        enabled: policy.enabled,
        action: policy.action,
        origin: policy.metadata.origin,
      })),
      ordering: inventory.ordering,
    });
    return 0;
  }

  if (command === "status") {
    console.log(JSON.stringify(readSpikeState(), null, 2));
    return 0;
  }

  if (command === "apply") {
    requireConfirm("apply");
    const macs = parseMacs();
    if (macs.length === 0) {
      console.error("Set UNIFI_SPIKE_MACS or pass --mac <address>.");
      return 2;
    }
    const inventory = await discoverInventory(client, siteId);
    const result = await applyInternetBlocks(client, inventory, macs);
    writeSpikeState({
      siteId: inventory.site.id,
      installId,
      macs,
      policyIds: result.created.map((policy) => policy.id),
      orderingBefore: inventory.ordering,
      createdAt: new Date().toISOString(),
    });
    printJson({
      created: result.created.map((policy) => ({ id: policy.id, name: policy.name, enabled: policy.enabled })),
      adminOrderPreserved: result.adminOrderPreserved,
      next: [
        "On each test device: confirm internet is down (new + already-open sessions) and LAN still works.",
        "Unrelated devices must keep internet.",
        "Then: UNIFI_SPIKE_CONFIRM=1 pnpm spike -- disable",
      ],
    });
    return result.adminOrderPreserved ? 0 : 1;
  }

  if (command === "disable" || command === "enable") {
    const state = readSpikeState();
    if (!state) {
      console.error("No spike state file. Run apply first.");
      return 2;
    }
    const policies = [];
    for (const id of state.policyIds) {
      policies.push(await client.getPolicy(state.siteId, id));
    }
    const updated = await setPoliciesEnabled(client, state.siteId, policies, command === "enable");
    printJson({
      updated: updated.map((policy) => ({ id: policy.id, name: policy.name, enabled: policy.enabled })),
      next:
        command === "disable"
          ? "On each test device: confirm internet is restored according to admin rules. Then cleanup."
          : "On each test device: confirm internet is blocked again.",
    });
    return 0;
  }

  if (command === "cleanup") {
    requireConfirm("cleanup");
    const state = readSpikeState();
    const inventory = await discoverInventory(client, siteId ?? state?.siteId);
    const ids = state?.policyIds?.length
      ? state.policyIds
      : ownedSpikePolicies(inventory.policies).map((policy) => policy.id);
    if (ids.length === 0) {
      console.error("No spike policies to delete. If create may have succeeded, keep the UniFi policy list for recovery.");
      return 1;
    }
    const result = await deletePolicies(client, inventory.site.id, ids);
    let preserved = true;
    try {
      const sourceZoneId = inventory.policies.find((policy) => ids.includes(policy.id))?.source.zoneId;
      const orderingAfter = await client.getPolicyOrdering(inventory.site.id, sourceZoneId);
      const before = state?.orderingBefore
        ? orderedPolicyIds(state.orderingBefore).filter((id) => !ids.includes(id))
        : orderedPolicyIds(inventory.ordering).filter((id) => !ids.includes(id));
      preserved = relativeOrderPreserved(before, orderedPolicyIds(orderingAfter));
    } catch {
      preserved = true;
    }
    if (result.failed.length === 0) clearSpikeState();
    printJson({
      deleted: result.deleted,
      failed: result.failed,
      adminOrderPreserved: preserved,
      recovery: result.failed.length
        ? "Cleanup failed. Leave remaining FamilyFi Spike policies in place and record their ids. Do not delete administrator policies."
        : undefined,
    });
    return result.failed.length === 0 && preserved ? 0 : 1;
  }

  console.error(`Unknown command: ${command}`);
  console.log(help());
  return 2;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(error instanceof UnifiConfigError ? 2 : 1);
  });
