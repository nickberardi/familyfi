import { resolveIntegrationBase } from "./base-url";
import { UnifiHttpError, UnifiTimeoutError } from "./errors";
import { collectPages } from "./paginate";
import { UNIFI_PAGE_LIMIT } from "./types";
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

export type UnifiClient = {
  getInfo(): Promise<ApplicationInfo>;
  listSites(): Promise<SiteOverview[]>;
  listNetworks(siteId: string): Promise<NetworkOverview[]>;
  getNetwork(siteId: string, networkId: string): Promise<NetworkDetails>;
  getNetworkReferences(siteId: string, networkId: string): Promise<NetworkReferences>;
  listZones(siteId: string): Promise<FirewallZone[]>;
  listClients(siteId: string, filter?: string): Promise<ClientOverview[]>;
  getClient(siteId: string, clientId: string): Promise<ClientOverview>;
  listPolicies(siteId: string): Promise<FirewallPolicy[]>;
  getPolicy(siteId: string, policyId: string): Promise<FirewallPolicy>;
  createPolicy(siteId: string, body: FirewallPolicyWrite): Promise<FirewallPolicy>;
  updatePolicy(siteId: string, policyId: string, body: FirewallPolicyWrite): Promise<FirewallPolicy>;
  deletePolicy(siteId: string, policyId: string): Promise<void>;
  getPolicyOrdering(siteId: string, sourceFirewallZoneId?: string): Promise<PolicyOrdering>;
};

export type HttpUnifiClientOptions = {
  apiKey: string;
  baseUrl?: string;
  consoleId?: string;
  timeoutMs?: number;
  tlsInsecure?: boolean;
  fetchImpl?: typeof fetch;
};

export function assertNotPolicyOrderingPut(method: string, path: string): void {
  if (method.toUpperCase() === "PUT" && path.includes("/firewall/policies/ordering")) {
    throw new Error("FamilyFi never reorders UniFi firewall policies.");
  }
}

function joinPath(base: string, path: string): string {
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function withQuery(path: string, query: Record<string, string | number | undefined>): string {
  const dummy = new URL(path, "https://unifi.invalid");
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") continue;
    dummy.searchParams.set(key, String(value));
  }
  return `${dummy.pathname}${dummy.search}`;
}

export class HttpUnifiClient implements UnifiClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpUnifiClientOptions) {
    this.baseUrl = resolveIntegrationBase({ baseUrl: options.baseUrl, consoleId: options.consoleId });
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? (options.tlsInsecure ? insecureFetch : fetch);
  }

  async getInfo(): Promise<ApplicationInfo> {
    return this.request("GET", "/v1/info");
  }

  async listSites(): Promise<SiteOverview[]> {
    return this.paginate("/v1/sites");
  }

  async listNetworks(siteId: string): Promise<NetworkOverview[]> {
    return this.paginate(`/v1/sites/${siteId}/networks`);
  }

  async getNetwork(siteId: string, networkId: string): Promise<NetworkDetails> {
    return this.request("GET", `/v1/sites/${siteId}/networks/${networkId}`);
  }

  async getNetworkReferences(siteId: string, networkId: string): Promise<NetworkReferences> {
    return this.request("GET", `/v1/sites/${siteId}/networks/${networkId}/references`);
  }

  async listZones(siteId: string): Promise<FirewallZone[]> {
    return this.paginate(`/v1/sites/${siteId}/firewall/zones`);
  }

  async listClients(siteId: string, filter?: string): Promise<ClientOverview[]> {
    return this.paginate(`/v1/sites/${siteId}/clients`, filter);
  }

  async getClient(siteId: string, clientId: string): Promise<ClientOverview> {
    return this.request("GET", `/v1/sites/${siteId}/clients/${clientId}`);
  }

  async listPolicies(siteId: string): Promise<FirewallPolicy[]> {
    return this.paginate(`/v1/sites/${siteId}/firewall/policies`);
  }

  async getPolicy(siteId: string, policyId: string): Promise<FirewallPolicy> {
    return this.request("GET", `/v1/sites/${siteId}/firewall/policies/${policyId}`);
  }

  async createPolicy(siteId: string, body: FirewallPolicyWrite): Promise<FirewallPolicy> {
    return this.request("POST", `/v1/sites/${siteId}/firewall/policies`, body);
  }

  async updatePolicy(siteId: string, policyId: string, body: FirewallPolicyWrite): Promise<FirewallPolicy> {
    return this.request("PUT", `/v1/sites/${siteId}/firewall/policies/${policyId}`, body);
  }

  async deletePolicy(siteId: string, policyId: string): Promise<void> {
    await this.request("DELETE", `/v1/sites/${siteId}/firewall/policies/${policyId}`);
  }

  async getPolicyOrdering(siteId: string, sourceFirewallZoneId?: string): Promise<PolicyOrdering> {
    return this.request(
      "GET",
      withQuery(`/v1/sites/${siteId}/firewall/policies/ordering`, {
        sourceFirewallZoneId,
      }),
    );
  }

  private async paginate<T>(path: string, filter?: string): Promise<T[]> {
    return collectPages((offset, limit) =>
      this.request<UnifiPage<T>>("GET", withQuery(path, { offset, limit, filter })),
    );
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    assertNotPolicyOrderingPut(method, path);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const init: RequestInit = {
        method,
        headers: {
          Accept: "application/json",
          "X-API-KEY": this.apiKey,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        signal: controller.signal,
        body: body === undefined ? undefined : JSON.stringify(body),
      };
      const response = await this.fetchImpl(joinPath(this.baseUrl, path), init);
      const text = await response.text();
      if (!response.ok) {
        throw new UnifiHttpError(response.status, method, path, text.slice(0, 2000));
      }
      if (!text) return undefined as T;
      return JSON.parse(text) as T;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new UnifiTimeoutError(method, path);
      }
      if (error instanceof Error && error.cause) {
        throw new Error(`UniFi ${method} ${path} failed: ${error.message} (${String(error.cause)})`, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export const defaultPageLimit = UNIFI_PAGE_LIMIT;

const insecureFetch: typeof fetch = async (input, init) => {
  const undici = await import("undici");
  const dispatcher = new undici.Agent({ connect: { rejectUnauthorized: false } });
  return undici.fetch(String(input), { ...(init as object), dispatcher } as never) as unknown as Response;
};
