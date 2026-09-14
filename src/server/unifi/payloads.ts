import { normalizeMac } from "../mac";
import { FAMILYFI_POLICY_PREFIX, type FirewallPolicy, type FirewallPolicyWrite, type UnifiFirewallSchedule } from "./types";

export const INTERNET_BLOCK_ACTION = "BLOCK" as const;

export function isFamPolicyName(name: string): boolean {
  return name.startsWith(FAMILYFI_POLICY_PREFIX) || name.startsWith("fam-");
}

export function sanitizeInstallId(value: string): string {
  const id = value.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12);
  if (!id) throw new Error("Installation id must contain letters or digits.");
  return id;
}

export { spikePolicyName } from "./names";

export function toPolicyUpdate(policy: FirewallPolicy, patch: Partial<FirewallPolicyWrite> = {}): FirewallPolicyWrite {
  return {
    name: patch.name ?? policy.name,
    description: patch.description ?? policy.description,
    enabled: patch.enabled ?? policy.enabled,
    loggingEnabled: patch.loggingEnabled ?? policy.loggingEnabled,
    action: patch.action ?? policy.action,
    ipProtocolScope: patch.ipProtocolScope ?? policy.ipProtocolScope,
    source: patch.source ?? policy.source,
    destination: patch.destination ?? policy.destination,
    connectionStateFilter: patch.connectionStateFilter ?? policy.connectionStateFilter,
    ipsecFilter: patch.ipsecFilter ?? policy.ipsecFilter,
    schedule: Object.hasOwn(patch, "schedule") ? patch.schedule : policy.schedule,
  };
}

export function internetBlockPolicy(input: {
  name: string;
  sourceZoneId: string;
  destinationZoneId: string;
  macAddresses: string[];
  enabled?: boolean;
  action?: "BLOCK" | "REJECT";
  schedule?: UnifiFirewallSchedule;
  description?: string;
}): FirewallPolicyWrite {
  const macAddresses = [...new Set(input.macAddresses.map(normalizeMac))].sort();
  if (macAddresses.length === 0) {
    throw new Error("An internet-block policy needs at least one MAC address.");
  }
  return {
    name: input.name,
    description: input.description ?? "FamilyFi managed internet block.",
    enabled: input.enabled ?? true,
    loggingEnabled: false,
    action: { type: input.action ?? INTERNET_BLOCK_ACTION },
    ipProtocolScope: { ipVersion: "IPV4_AND_IPV6" },
    source: {
      zoneId: input.sourceZoneId,
      trafficFilter: {
        type: "MAC_ADDRESS",
        macAddressFilter: { macAddresses },
      },
    },
    destination: {
      zoneId: input.destinationZoneId,
    },
    ...(input.schedule ? { schedule: input.schedule } : {}),
  };
}
