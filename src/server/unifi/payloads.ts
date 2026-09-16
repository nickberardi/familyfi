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

export function dpiCategoryBlockPolicy(input: {
  name: string;
  sourceZoneId: string;
  destinationZoneId: string;
  macAddresses: string[];
  applicationCategoryIds: number[];
  enabled?: boolean;
  action?: "BLOCK" | "REJECT";
  schedule?: UnifiFirewallSchedule;
  description?: string;
}): FirewallPolicyWrite {
  const macAddresses = [...new Set(input.macAddresses.map(normalizeMac))].sort();
  const applicationCategoryIds = [...new Set(input.applicationCategoryIds)].sort((a, b) => a - b);
  if (macAddresses.length === 0) {
    throw new Error("A category DPI policy needs at least one MAC address.");
  }
  if (applicationCategoryIds.length === 0) {
    throw new Error("A category DPI policy needs at least one category id.");
  }
  return {
    name: input.name,
    description: input.description ?? "FamilyFi managed category block.",
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
      trafficFilter: {
        type: "APPLICATION_CATEGORY",
        applicationCategoryFilter: { applicationCategoryIds },
      },
    },
    ...(input.schedule ? { schedule: input.schedule } : {}),
  };
}

export function dpiAppBlockPolicy(input: {
  name: string;
  sourceZoneId: string;
  destinationZoneId: string;
  macAddresses: string[];
  applicationIds: number[];
  enabled?: boolean;
  action?: "BLOCK" | "REJECT";
  schedule?: UnifiFirewallSchedule;
  description?: string;
}): FirewallPolicyWrite {
  const macAddresses = [...new Set(input.macAddresses.map(normalizeMac))].sort();
  const applicationIds = [...new Set(input.applicationIds)].sort((a, b) => a - b);
  if (macAddresses.length === 0) {
    throw new Error("An app DPI policy needs at least one MAC address.");
  }
  if (applicationIds.length === 0) {
    throw new Error("An app DPI policy needs at least one application id.");
  }
  if (applicationIds.length > 100) {
    throw new Error("An app DPI policy may target at most 100 applications.");
  }
  return {
    name: input.name,
    description: input.description ?? "FamilyFi managed app block.",
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
      trafficFilter: {
        type: "APPLICATION",
        applicationFilter: { applicationIds },
      },
    },
    ...(input.schedule ? { schedule: input.schedule } : {}),
  };
}

function networkSourceFilter(networkIds: string[]) {
  const ids = [...new Set(networkIds)].sort();
  if (ids.length === 0) {
    throw new Error("A network DPI policy needs at least one network id.");
  }
  return {
    type: "NETWORK" as const,
    networkFilter: { matchOpposite: false, networkIds: ids },
  };
}

/** Category DPI with UniFi source type NETWORK (managed VLAN ids — not MAC fan-out). */
export function dpiCategoryNetworkBlockPolicy(input: {
  name: string;
  sourceZoneId: string;
  destinationZoneId: string;
  networkIds: string[];
  applicationCategoryIds: number[];
  enabled?: boolean;
  action?: "BLOCK" | "REJECT";
  schedule?: UnifiFirewallSchedule;
  description?: string;
}): FirewallPolicyWrite {
  const applicationCategoryIds = [...new Set(input.applicationCategoryIds)].sort((a, b) => a - b);
  if (applicationCategoryIds.length === 0) {
    throw new Error("A category DPI policy needs at least one category id.");
  }
  return {
    name: input.name,
    description: input.description ?? "FamilyFi managed network category block.",
    enabled: input.enabled ?? true,
    loggingEnabled: false,
    action: { type: input.action ?? INTERNET_BLOCK_ACTION },
    ipProtocolScope: { ipVersion: "IPV4_AND_IPV6" },
    source: {
      zoneId: input.sourceZoneId,
      trafficFilter: networkSourceFilter(input.networkIds),
    },
    destination: {
      zoneId: input.destinationZoneId,
      trafficFilter: {
        type: "APPLICATION_CATEGORY",
        applicationCategoryFilter: { applicationCategoryIds },
      },
    },
    ...(input.schedule ? { schedule: input.schedule } : {}),
  };
}

/** App DPI with UniFi source type NETWORK (managed VLAN ids — not MAC fan-out). */
export function dpiAppNetworkBlockPolicy(input: {
  name: string;
  sourceZoneId: string;
  destinationZoneId: string;
  networkIds: string[];
  applicationIds: number[];
  enabled?: boolean;
  action?: "BLOCK" | "REJECT";
  schedule?: UnifiFirewallSchedule;
  description?: string;
}): FirewallPolicyWrite {
  const applicationIds = [...new Set(input.applicationIds)].sort((a, b) => a - b);
  if (applicationIds.length === 0) {
    throw new Error("An app DPI policy needs at least one application id.");
  }
  if (applicationIds.length > 100) {
    throw new Error("An app DPI policy may target at most 100 applications.");
  }
  return {
    name: input.name,
    description: input.description ?? "FamilyFi managed network app block.",
    enabled: input.enabled ?? true,
    loggingEnabled: false,
    action: { type: input.action ?? INTERNET_BLOCK_ACTION },
    ipProtocolScope: { ipVersion: "IPV4_AND_IPV6" },
    source: {
      zoneId: input.sourceZoneId,
      trafficFilter: networkSourceFilter(input.networkIds),
    },
    destination: {
      zoneId: input.destinationZoneId,
      trafficFilter: {
        type: "APPLICATION",
        applicationFilter: { applicationIds },
      },
    },
    ...(input.schedule ? { schedule: input.schedule } : {}),
  };
}
