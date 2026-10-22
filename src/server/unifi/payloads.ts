import type { LockDnsPart } from "@/lib/policy-names";
import { normalizeMac } from "../mac";
import { lockDnsTargets, type LockDnsTargets } from "./lock-dns";
import type { FirewallPolicy, FirewallPolicyWrite, IpAddressFilter, UnifiFirewallSchedule } from "./types";

export const INTERNET_BLOCK_ACTION = "BLOCK" as const;

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

/**
 * Website block (#94): UniFi matches the domains, and their subdomains, by watching DNS
 * lookups, so a device using its own DNS can get around it unless Lock DNS covers it. Source
 * is either the covered devices' MACs or managed networks.
 */
export function domainBlockPolicy(input: {
  name: string;
  sourceZoneId: string;
  destinationZoneId: string;
  macAddresses?: string[];
  networkIds?: string[];
  domains: string[];
  enabled?: boolean;
  schedule?: UnifiFirewallSchedule;
}): FirewallPolicyWrite {
  const domains = [...new Set(input.domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean))].sort();
  if (domains.length === 0) throw new Error("A website policy needs at least one domain.");
  let sourceFilter;
  if (input.networkIds) {
    sourceFilter = networkSourceFilter(input.networkIds);
  } else {
    const macAddresses = [...new Set((input.macAddresses ?? []).map(normalizeMac))].sort();
    if (macAddresses.length === 0) throw new Error("A website policy needs at least one MAC address.");
    sourceFilter = { type: "MAC_ADDRESS", macAddressFilter: { macAddresses } };
  }
  return {
    name: input.name,
    description: "FamilyFi managed website block.",
    enabled: input.enabled ?? true,
    loggingEnabled: false,
    action: { type: INTERNET_BLOCK_ACTION },
    ipProtocolScope: { ipVersion: "IPV4_AND_IPV6" },
    source: { zoneId: input.sourceZoneId, trafficFilter: sourceFilter },
    destination: {
      zoneId: input.destinationZoneId,
      trafficFilter: { type: "DOMAIN", domainFilter: { type: "DOMAINS", domains } },
    },
    ...(input.schedule ? { schedule: input.schedule } : {}),
  };
}

/** Plain DNS and DNS over TLS. */
export const DNS_PORTS = [53, 853] as const;

/**
 * One part of the built-in Lock DNS rule for the covered devices' MACs (`LOCK_DNS_PARTS`):
 * `ports` blocks TCP and UDP 53 and 853 to the destination zone, the internet, so the gateway and
 * any DNS server on the home network still answer; `addresses` and `addresses-v6` block every port
 * to the encrypted DNS services' addresses, one IP version each; `names` blocks their host names,
 * which the gateway sees now that their lookups go through it.
 */
export function lockDnsBlockPolicy(input: {
  name: string;
  part: LockDnsPart;
  sourceZoneId: string;
  destinationZoneId: string;
  macAddresses: string[];
  enabled?: boolean;
  /** What it blocks, leaving out the household's own DNS. */
  targets?: LockDnsTargets;
}): FirewallPolicyWrite {
  const targets = input.targets ?? lockDnsTargets();
  if (input.part === "names") return { ...domainBlockPolicy({ ...input, domains: targets.hosts }), description: LOCK_DNS_DESCRIPTION };
  const macAddresses = [...new Set(input.macAddresses.map(normalizeMac))].sort();
  if (macAddresses.length === 0) throw new Error("A Lock DNS policy needs at least one MAC address.");
  const common = {
    name: input.name,
    description: LOCK_DNS_DESCRIPTION,
    enabled: input.enabled ?? true,
    loggingEnabled: false,
    action: { type: INTERNET_BLOCK_ACTION },
    source: { zoneId: input.sourceZoneId, trafficFilter: { type: "MAC_ADDRESS", macAddressFilter: { macAddresses } } },
  };
  if (input.part === "ports") {
    const portFilter = { type: "PORTS", matchOpposite: false, items: DNS_PORTS.map((value) => ({ type: "PORT_NUMBER" as const, value })) } as const;
    return {
      ...common,
      ipProtocolScope: { ipVersion: "IPV4_AND_IPV6", protocolFilter: { type: "PRESET", preset: { name: "TCP_UDP" } } },
      destination: {
        zoneId: input.destinationZoneId,
        // The household's own DNS servers stay reachable: every address but theirs.
        trafficFilter: targets.allowed.length
          ? { type: "IP_ADDRESS", ipAddressFilter: { type: "IP_ADDRESSES", matchOpposite: true, items: addressItems(targets.allowed) }, portFilter }
          : { type: "PORT", portFilter },
      },
    };
  }
  const version = input.part === "addresses" ? "ipv4" : "ipv6";
  return {
    ...common,
    ipProtocolScope: { ipVersion: version === "ipv4" ? "IPV4" : "IPV6" },
    destination: {
      zoneId: input.destinationZoneId,
      trafficFilter: {
        type: "IP_ADDRESS",
        ipAddressFilter: {
          type: "IP_ADDRESSES",
          matchOpposite: false,
          items: addressItems(targets[version]),
        },
      },
    },
  };
}

function addressItems(values: string[]): IpAddressFilter["items"] {
  return values.map((value) => ({ type: value.includes("/") ? "SUBNET" : "IP_ADDRESS", value }));
}

const LOCK_DNS_DESCRIPTION = "FamilyFi managed Lock DNS: blocks DNS servers other than the gateway.";
