export const UNIFI_PAGE_LIMIT = 200;
export { FAMILYFI_POLICY_PREFIX } from "@/lib/policy-names";
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
  dhcpConfiguration?: {
    mode: "SERVER" | "RELAY" | string;
    dnsServerIpAddressesOverride?: string[] | null;
  } | null;
};

export type NetworkDetails = NetworkOverview & {
  /** Set by FamilyFi when the network's own read failed and only its overview is known. */
  detailsUnread?: boolean;
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
  uplinkDeviceId?: string;
};

export type SiteDeviceOverview = {
  id: string;
  name: string;
  model?: string;
  state?: string;
  /** What the device does on the site: `gateway`, `switching`, `accessPoint`. */
  features?: string[];
};

/** `GET /v1/sites/{siteId}/devices/{deviceId}/statistics/latest`; the API omits what a device does not report. */
export type DeviceLatestStatistics = {
  uptimeSec?: number;
  lastHeartbeatAt?: string;
  loadAverage1Min?: number;
  loadAverage5Min?: number;
  loadAverage15Min?: number;
  cpuUtilizationPct?: number;
  memoryUtilizationPct?: number;
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

export type DomainFilter = {
  type: "DOMAINS";
  domains: string[];
};

export type PortFilter = {
  type: "PORTS";
  matchOpposite: boolean;
  items: { type: "PORT_NUMBER"; value: number }[];
};

export type IpAddressFilter = {
  type: "IP_ADDRESSES";
  matchOpposite: boolean;
  items: { type: "IP_ADDRESS" | "SUBNET"; value: string }[];
};

/** Destination traffic filter — internet (zone only), DPI APPLICATION_*, DOMAIN, PORT or IP_ADDRESS shapes. */
export type DestinationTrafficFilter =
  | {
      type: "PORT";
      portFilter: PortFilter;
    }
  | {
      type: "IP_ADDRESS";
      ipAddressFilter: IpAddressFilter;
      portFilter?: PortFilter;
    }
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
      type: "DOMAIN";
      domainFilter: DomainFilter;
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
