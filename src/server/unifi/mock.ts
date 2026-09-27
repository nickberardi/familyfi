import { randomInt, randomUUID } from "node:crypto";
import type { UnifiClient } from "./client";
import { UnifiHttpError } from "./errors";
import type {
  ApplicationInfo,
  ClientOverview,
  DpiCatalogItem,
  FirewallPolicy,
  FirewallPolicyWrite,
  FirewallZone,
  GuestActionResponse,
  HotspotVoucher,
  NetworkDetails,
  NetworkOverview,
  NetworkReferences,
  PolicyOrdering,
  SiteOverview,
  UnifiPage,
  WifiBroadcast,
} from "./types";
import { UNIFI_PAGE_LIMIT } from "./types";

export type MockUnifiState = {
  version: string;
  sites: SiteOverview[];
  networks: NetworkDetails[];
  zones: FirewallZone[];
  clients: ClientOverview[];
  wifiBroadcasts: WifiBroadcast[];
  vouchers: HotspotVoucher[];
  policies: FirewallPolicy[];
  ordering: PolicyOrdering;
  networkClientIds: Map<string, Set<string>>;
  dpiCategories: DpiCatalogItem[];
  dpiApplications: DpiCatalogItem[];
};

function page<T>(items: T[], offset: number, limit: number): UnifiPage<T> {
  const data = items.slice(offset, offset + limit);
  return { count: data.length, data, limit, offset, totalCount: items.length };
}

export function createMockUnifiState(partial: Partial<MockUnifiState> = {}): MockUnifiState {
  return {
    version: partial.version ?? "9.5.0",
    sites: partial.sites ?? [],
    networks: partial.networks ?? [],
    zones: partial.zones ?? [],
    clients: partial.clients ?? [],
    wifiBroadcasts: partial.wifiBroadcasts ?? [],
    vouchers: partial.vouchers ?? [],
    policies: partial.policies ?? [],
    ordering: partial.ordering ?? { beforeSystemDefined: [], afterSystemDefined: [] },
    networkClientIds: partial.networkClientIds ?? new Map(),
    dpiCategories: partial.dpiCategories ?? [],
    dpiApplications: partial.dpiApplications ?? [],
  };
}

export class MockUnifiClient implements UnifiClient {
  readonly calls: { method: string; path: string; body?: unknown }[] = [];
  /** Throw instead of creating. May inspect the write body. */
  createError?: Error | ((body: FirewallPolicyWrite) => Error | undefined);
  /** Persist the policy, then throw — interrupted create. */
  throwAfterCreate = false;

  constructor(readonly state: MockUnifiState) {}

  async getInfo(): Promise<ApplicationInfo> {
    this.record("GET", "/v1/info");
    return { applicationVersion: this.state.version };
  }

  async listSites(): Promise<SiteOverview[]> {
    this.record("GET", "/v1/sites");
    return [...this.state.sites];
  }

  async listNetworks(siteId: string): Promise<NetworkOverview[]> {
    this.record("GET", `/v1/sites/${siteId}/networks`);
    return [...this.state.networks];
  }

  async getNetwork(siteId: string, networkId: string): Promise<NetworkDetails> {
    this.record("GET", `/v1/sites/${siteId}/networks/${networkId}`);
    const network = this.state.networks.find((item) => item.id === networkId);
    if (!network) throw notFound("GET", `/v1/sites/${siteId}/networks/${networkId}`);
    return network;
  }

  async getNetworkReferences(siteId: string, networkId: string): Promise<NetworkReferences> {
    this.record("GET", `/v1/sites/${siteId}/networks/${networkId}/references`);
    const ids = [...(this.state.networkClientIds.get(networkId) ?? [])];
    return {
      referenceResources: [
        {
          resourceType: "CLIENT",
          referenceCount: Math.max(ids.length, 1),
          references: ids.map((referenceId) => ({ referenceId })),
        },
      ],
    };
  }

  async listZones(siteId: string): Promise<FirewallZone[]> {
    this.record("GET", `/v1/sites/${siteId}/firewall/zones`);
    return [...this.state.zones];
  }

  async listClients(siteId: string): Promise<ClientOverview[]> {
    this.record("GET", `/v1/sites/${siteId}/clients`);
    return [...this.state.clients];
  }

  async getClient(siteId: string, clientId: string): Promise<ClientOverview> {
    this.record("GET", `/v1/sites/${siteId}/clients/${clientId}`);
    const client = this.state.clients.find((item) => item.id === clientId);
    if (!client) throw notFound("GET", `/v1/sites/${siteId}/clients/${clientId}`);
    return client;
  }

  async authorizeGuest(siteId: string, clientId: string, timeLimitMinutes: number): Promise<GuestActionResponse> {
    const path = `/v1/sites/${siteId}/clients/${clientId}/actions`;
    this.record("POST", path, { action: "AUTHORIZE_GUEST_ACCESS", timeLimitMinutes });
    const client = this.state.clients.find((item) => item.id === clientId);
    if (!client) throw notFound("POST", path);
    if (client.access?.type !== "GUEST") throw new UnifiHttpError(400, "POST", path, "Client must be a guest");
    const authorizedAt = new Date();
    const grantedAuthorization = {
      authorizationMethod: "API" as const,
      authorizedAt: authorizedAt.toISOString(),
      expiresAt: new Date(authorizedAt.getTime() + timeLimitMinutes * 60_000).toISOString(),
    };
    const revokedAuthorization = client.access.authorization;
    client.access = { type: "GUEST", authorized: true, authorization: grantedAuthorization };
    return { action: "AUTHORIZE_GUEST_ACCESS", grantedAuthorization, ...(revokedAuthorization ? { revokedAuthorization } : {}) };
  }

  async unauthorizeGuest(siteId: string, clientId: string): Promise<GuestActionResponse> {
    const path = `/v1/sites/${siteId}/clients/${clientId}/actions`;
    this.record("POST", path, { action: "UNAUTHORIZE_GUEST_ACCESS" });
    const client = this.state.clients.find((item) => item.id === clientId);
    if (!client) throw notFound("POST", path);
    const revokedAuthorization = client.access?.authorization;
    if (client.access?.type !== "GUEST" || !revokedAuthorization) {
      throw new UnifiHttpError(400, "POST", path, "Guest is not authorized");
    }
    client.access = { type: "GUEST", authorized: false };
    return { action: "UNAUTHORIZE_GUEST_ACCESS", revokedAuthorization };
  }

  async listWifiBroadcasts(siteId: string): Promise<WifiBroadcast[]> {
    this.record("GET", `/v1/sites/${siteId}/wifi/broadcasts`);
    return [...this.state.wifiBroadcasts];
  }

  async listVouchers(siteId: string): Promise<HotspotVoucher[]> {
    this.record("GET", `/v1/sites/${siteId}/hotspot/vouchers`);
    return [...this.state.vouchers];
  }

  async createVoucher(siteId: string, timeLimitMinutes: number): Promise<HotspotVoucher> {
    this.record("POST", `/v1/sites/${siteId}/hotspot/vouchers`, {
      count: 1, name: "FamilyFi guest", authorizedGuestLimit: 1, timeLimitMinutes,
    });
    const voucher: HotspotVoucher = {
      id: randomUUID(), code: String(randomInt(1_000_000_000, 10_000_000_000)),
      createdAt: new Date().toISOString(), timeLimitMinutes,
      authorizedGuestLimit: 1, authorizedGuestCount: 0, expired: false,
    };
    this.state.vouchers.push(voucher);
    return voucher;
  }

  async deleteVoucher(siteId: string, voucherId: string): Promise<number> {
    const path = `/v1/sites/${siteId}/hotspot/vouchers/${voucherId}`;
    this.record("DELETE", path);
    if (!this.state.vouchers.some((item) => item.id === voucherId)) throw notFound("DELETE", path);
    this.state.vouchers = this.state.vouchers.filter((item) => item.id !== voucherId);
    return 1;
  }

  async listPolicies(siteId: string): Promise<FirewallPolicy[]> {
    this.record("GET", `/v1/sites/${siteId}/firewall/policies`);
    return [...this.state.policies];
  }

  async getPolicy(siteId: string, policyId: string): Promise<FirewallPolicy> {
    this.record("GET", `/v1/sites/${siteId}/firewall/policies/${policyId}`);
    const policy = this.state.policies.find((item) => item.id === policyId);
    if (!policy) throw notFound("GET", `/v1/sites/${siteId}/firewall/policies/${policyId}`);
    return policy;
  }

  async createPolicy(siteId: string, body: FirewallPolicyWrite): Promise<FirewallPolicy> {
    this.record("POST", `/v1/sites/${siteId}/firewall/policies`, body);
    const failure = typeof this.createError === "function" ? this.createError(body) : this.createError;
    if (failure) throw failure;
    const policy: FirewallPolicy = {
      ...body,
      id: randomUUID(),
      index: this.state.policies.length + 1,
      metadata: { origin: "USER_DEFINED" },
    };
    this.state.policies.push(policy);
    this.state.ordering.afterSystemDefined.push(policy.id);
    if (this.throwAfterCreate) throw new Error("interrupted after UniFi create");
    return policy;
  }

  async updatePolicy(siteId: string, policyId: string, body: FirewallPolicyWrite): Promise<FirewallPolicy> {
    this.record("PUT", `/v1/sites/${siteId}/firewall/policies/${policyId}`, body);
    const index = this.state.policies.findIndex((item) => item.id === policyId);
    if (index === -1) throw notFound("PUT", `/v1/sites/${siteId}/firewall/policies/${policyId}`);
    const current = this.state.policies[index]!;
    // PUT replaces the policy with the full write body; only server-owned fields carry over.
    const next: FirewallPolicy = { ...body, id: current.id, index: current.index, metadata: current.metadata };
    this.state.policies[index] = next;
    return next;
  }

  async deletePolicy(siteId: string, policyId: string): Promise<void> {
    this.record("DELETE", `/v1/sites/${siteId}/firewall/policies/${policyId}`);
    if (!this.state.policies.some((item) => item.id === policyId)) {
      throw notFound("DELETE", `/v1/sites/${siteId}/firewall/policies/${policyId}`);
    }
    this.state.policies = this.state.policies.filter((item) => item.id !== policyId);
    this.state.ordering.afterSystemDefined = this.state.ordering.afterSystemDefined.filter((id) => id !== policyId);
    this.state.ordering.beforeSystemDefined = this.state.ordering.beforeSystemDefined.filter((id) => id !== policyId);
  }

  async getPolicyOrdering(siteId: string, sourceFirewallZoneId?: string): Promise<PolicyOrdering> {
    this.record("GET", `/v1/sites/${siteId}/firewall/policies/ordering`);
    // The live console refuses an ordering read without a source zone (see spike.ts).
    if (!sourceFirewallZoneId) {
      throw new UnifiHttpError(400, "GET", `/v1/sites/${siteId}/firewall/policies/ordering`, "sourceFirewallZoneId is required");
    }
    // Each source zone has its own ordering document, listing that zone's policies.
    const inZone = (id: string) =>
      this.state.policies.some((policy) => policy.id === id && policy.source.zoneId === sourceFirewallZoneId);
    return {
      afterSystemDefined: this.state.ordering.afterSystemDefined.filter(inZone),
      beforeSystemDefined: this.state.ordering.beforeSystemDefined.filter(inZone),
    };
  }

  async listDpiCategories(filter?: string): Promise<DpiCatalogItem[]> {
    this.record("GET", "/v1/dpi/categories");
    return filterCatalog(this.state.dpiCategories, filter);
  }

  async listDpiApplications(filter?: string): Promise<DpiCatalogItem[]> {
    this.record("GET", "/v1/dpi/applications");
    return filterCatalog(this.state.dpiApplications, filter);
  }

  pageForTests<T>(items: T[], offset: number, limit = UNIFI_PAGE_LIMIT): UnifiPage<T> {
    return page(items, offset, limit);
  }

  private record(method: string, path: string, body?: unknown) {
    this.calls.push(body === undefined ? { method, path } : { method, path, body });
  }
}

/** What the Integration API answers for an id it does not have, as `HttpUnifiClient` surfaces it. */
function notFound(method: string, path: string): UnifiHttpError {
  return new UnifiHttpError(404, method, path, "Not Found");
}

function filterCatalog(items: DpiCatalogItem[], filter?: string): DpiCatalogItem[] {
  const q = filter?.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((item) => item.name.toLowerCase().includes(q) || String(item.id).includes(q));
}
