export const UNIFI_PAGE_LIMIT = 200;
export const FAMILYFI_POLICY_PREFIX = "FamilyFi ";
/**
 * Policy-name prefix used by the pre-1.0 spike CLI. Nothing generates it any
 * more; it is recognised so a console carrying leftover spike policies still
 * reads them as ours. Ownership is decided by recorded id and creation
 * evidence — a name prefix alone never claims a policy.
 */
export const LEGACY_POLICY_PREFIX = "fam-";
export const UNIFI_API_VERSION = "10.4.57";

export type UnifiPage<T> = {
  count: number;
  data: T[];
  limit: number;
  offset: number;
  totalCount: number;
};

export type ApplicationInfo = {
  applicationVersion: string;
};

export type SiteOverview = {
  id: string;
  internalReference: string;
  name: string;
};

export type NetworkOverview = {
  id: string;
  name: string;
  default: boolean;
  enabled: boolean;
  management: string;
  vlanId: number;
  zoneId?: string;
};

export type GatewayIpv4Configuration = {
  hostIpAddress: string;
  prefixLength: number;
  additionalHostIpSubnets?: string[];
};

export type NetworkDetails = NetworkOverview & {
  internetAccessEnabled?: boolean;
  ipv4Configuration?: GatewayIpv4Configuration;
  ipv6Configuration?: {
    additionalHostIpSubnets?: string[];
  };
};

export type NetworkReferenceResource = {
  resourceType: string;
  referenceCount: number;
  references?: { referenceId: string }[];
};

export type NetworkReferences = {
  referenceResources: NetworkReferenceResource[];
};

export type FirewallZone = {
  id: string;
  name: string;
  networkIds: string[];
};

export type ClientOverview = {
  id: string;
  name: string;
  type: string;
  ipAddress?: string;
  macAddress?: string;
  connectedAt?: string;
};

export type FirewallPolicyAction = {
  type: "ALLOW" | "BLOCK" | "REJECT" | string;
};

export type MacAddressFilter = {
  macAddresses: string[];
};

export type NetworkFilter = {
  matchOpposite: boolean;
  networkIds: string[];
};

export type SourceTrafficFilter = {
  type: string;
  macAddressFilter?: MacAddressFilter;
  networkFilter?: NetworkFilter;
};

export type ApplicationCategoryFilter = {
  applicationCategoryIds: number[];
};

export type ApplicationFilter = {
  applicationIds: number[];
};

/** Destination traffic filter — internet (zone only) or DPI APPLICATION_* shapes. */
export type DestinationTrafficFilter =
  | {
      type: "APPLICATION_CATEGORY";
      applicationCategoryFilter: ApplicationCategoryFilter;
      portFilter?: unknown;
    }
  | {
      type: "APPLICATION";
      applicationFilter: ApplicationFilter;
      portFilter?: unknown;
    }
  | {
      type: string;
      macAddressFilter?: MacAddressFilter;
      applicationCategoryFilter?: ApplicationCategoryFilter;
      applicationFilter?: ApplicationFilter;
      portFilter?: unknown;
    };

export type FirewallPolicySourceEndpoint = {
  zoneId: string;
  trafficFilter?: SourceTrafficFilter;
};

export type FirewallPolicyDestinationEndpoint = {
  zoneId: string;
  trafficFilter?: DestinationTrafficFilter;
};

/** @deprecated Prefer source/destination-specific endpoint types. */
export type FirewallPolicyEndpoint = FirewallPolicySourceEndpoint | FirewallPolicyDestinationEndpoint;

export type DpiCatalogItem = {
  id: number;
  name: string;
};

export type IpProtocolScope = {
  ipVersion: "IPV4" | "IPV6" | "IPV4_AND_IPV6" | string;
  protocolFilter?: unknown;
};

export type UnifiWeekday =
  | "SUNDAY"
  | "MONDAY"
  | "TUESDAY"
  | "WEDNESDAY"
  | "THURSDAY"
  | "FRIDAY"
  | "SATURDAY";

export type UnifiScheduleTime = {
  startTime: string;
  stopTime: string;
};

export type UnifiFirewallSchedule =
  | { mode: "EVERY_DAY"; timeFilter: UnifiScheduleTime }
  | { mode: "EVERY_WEEK"; repeatOnDays: UnifiWeekday[]; timeFilter: UnifiScheduleTime };

export type FirewallPolicyWrite = {
  name: string;
  description?: string;
  enabled: boolean;
  loggingEnabled: boolean;
  action: FirewallPolicyAction;
  ipProtocolScope: IpProtocolScope;
  source: FirewallPolicySourceEndpoint;
  destination: FirewallPolicyDestinationEndpoint;
  connectionStateFilter?: string[];
  ipsecFilter?: string;
  schedule?: UnifiFirewallSchedule | null;
};

export type FirewallPolicy = FirewallPolicyWrite & {
  id: string;
  index: number;
  metadata: { origin: string };
};

export type PolicyOrdering = {
  afterSystemDefined: string[];
  beforeSystemDefined: string[];
};

export type ClientZoneMapping = {
  clientId: string;
  macAddress: string;
  ipAddress: string | null;
  networkId: string | null;
  sourceZoneId: string | null;
  method: "network-reference" | "ipv4-subnet" | "unresolved";
};
