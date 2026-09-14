import { randomUUID } from "node:crypto";
import type { UnifiClient } from "./client";
import type {
  ApplicationInfo,
  ClientOverview,
  FirewallPolicy,
  FirewallPolicyWrite,
  FirewallZone,
  NetworkDetails,
  NetworkOverview,
  NetworkReferences,
  PolicyOrdering,
  SiteOverview,
  UnifiPage,
} from "./types";
import { UNIFI_PAGE_LIMIT } from "./types";

export type MockUnifiState = {
  version: string;
  sites: SiteOverview[];
  networks: NetworkDetails[];
  zones: FirewallZone[];
  clients: ClientOverview[];
  policies: FirewallPolicy[];
  ordering: PolicyOrdering;
  networkClientIds: Map<string, Set<string>>;
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
    policies: partial.policies ?? [],
    ordering: partial.ordering ?? { beforeSystemDefined: [], afterSystemDefined: [] },
    networkClientIds: partial.networkClientIds ?? new Map(),
  };
}

export class MockUnifiClient implements UnifiClient {
  readonly calls: { method: string; path: string }[] = [];

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
    if (!network) throw new Error("network not found");
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
    if (!client) throw new Error("client not found");
    return client;
  }

  async listPolicies(siteId: string): Promise<FirewallPolicy[]> {
    this.record("GET", `/v1/sites/${siteId}/firewall/policies`);
    return [...this.state.policies];
  }

  async getPolicy(siteId: string, policyId: string): Promise<FirewallPolicy> {
    this.record("GET", `/v1/sites/${siteId}/firewall/policies/${policyId}`);
    const policy = this.state.policies.find((item) => item.id === policyId);
    if (!policy) throw new Error("policy not found");
    return policy;
  }

  async createPolicy(siteId: string, body: FirewallPolicyWrite): Promise<FirewallPolicy> {
    this.record("POST", `/v1/sites/${siteId}/firewall/policies`);
    const policy: FirewallPolicy = {
      ...body,
      id: randomUUID(),
      index: this.state.policies.length + 1,
      metadata: { origin: "USER_DEFINED" },
    };
    this.state.policies.push(policy);
    this.state.ordering.afterSystemDefined.push(policy.id);
    return policy;
  }

  async updatePolicy(siteId: string, policyId: string, body: FirewallPolicyWrite): Promise<FirewallPolicy> {
    this.record("PUT", `/v1/sites/${siteId}/firewall/policies/${policyId}`);
    const index = this.state.policies.findIndex((item) => item.id === policyId);
    if (index === -1) throw new Error("policy not found");
    const current = this.state.policies[index]!;
    const next = { ...current, ...body };
    this.state.policies[index] = next;
    return next;
  }

  async deletePolicy(siteId: string, policyId: string): Promise<void> {
    this.record("DELETE", `/v1/sites/${siteId}/firewall/policies/${policyId}`);
    this.state.policies = this.state.policies.filter((item) => item.id !== policyId);
    this.state.ordering.afterSystemDefined = this.state.ordering.afterSystemDefined.filter((id) => id !== policyId);
    this.state.ordering.beforeSystemDefined = this.state.ordering.beforeSystemDefined.filter((id) => id !== policyId);
  }

  async getPolicyOrdering(siteId: string, sourceFirewallZoneId?: string): Promise<PolicyOrdering> {
    this.record("GET", `/v1/sites/${siteId}/firewall/policies/ordering`);
    void sourceFirewallZoneId;
    return {
      afterSystemDefined: [...this.state.ordering.afterSystemDefined],
      beforeSystemDefined: [...this.state.ordering.beforeSystemDefined],
    };
  }

  pageForTests<T>(items: T[], offset: number, limit = UNIFI_PAGE_LIMIT): UnifiPage<T> {
    return page(items, offset, limit);
  }

  private record(method: string, path: string) {
    this.calls.push({ method, path });
  }
}
