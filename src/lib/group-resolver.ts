/**
 * A group's own DNS-over-HTTPS endpoint, as every client's group detail shows it.
 *
 * Its purpose is accuracy of reporting, not enforcement: with an override set, this group's
 * category verdicts are measured through *its* resolver, so its cards answer for the devices it
 * actually has rather than for the rest of the house. Pointing those devices at that resolver is a
 * DHCP or client-side job, outside FamilyFi.
 */
import type { ApiRequest } from "./api-client";

/** `GET /groups/{id}/resolver`: where this group's checks are measured. */
export type GroupResolver = {
  source: "doh" | "dhcp" | "unknown";
  networks: { id: string; name: string; servers: string[]; reason: string | null }[];
  reason: string | null;
};

export const GROUP_RESOLVER_COPY = {
  title: "DNS resolver",
  fieldLabel: (groupName: string) => `DNS-over-HTTPS endpoint for ${groupName}`,
  placeholder: "https://dns.example.com/dns-query/profile",
  /** Not just "Save" — the group's Edit form already has one on the same screen. */
  save: "Save endpoint",
  cancel: "Cancel",
  overrideNote: (groupName: string) => `DNS-over-HTTPS override for ${groupName}. Category results here are measured through this endpoint.`,
  replace: "Replace",
  remove: "Remove override",
  override: "Override for this member",
  hostNote: "Checks run from the FamilyFi host. A device on another VLAN may get a different answer.",
  saveFailed: "Could not save the endpoint.",
  removeFailed: "Could not remove the override.",
} as const;

/** Where a group without an override is measured, in a sentence. */
export function groupResolverSummary(resolver: GroupResolver | null): string {
  if (resolver?.reason) return resolver.reason;
  if (resolver?.source === "dhcp") return "Uses the DNS servers assigned to this group's devices by UniFi DHCP.";
  if (resolver?.source === "doh") return "Uses the household's DNS-over-HTTPS override.";
  return "Resolver information is unavailable.";
}

/** One line per network: its servers, or why there are none. */
export function groupResolverNetworkLine(network: GroupResolver["networks"][number]): string {
  return `${network.name}: ${network.reason ?? network.servers.join(", ")}`;
}

/** Whether a typed endpoint is worth sending: longer than `https://`. */
export function canSaveGroupResolver(url: string): boolean {
  return url.trim().length > 8;
}

export function loadGroupResolver(request: ApiRequest, groupId: string): Promise<GroupResolver | null> {
  return request<{ resolver: GroupResolver }>(`/api/v1/groups/${groupId}/resolver`)
    .then((res) => res.resolver)
    .catch(() => null);
}

/** Sets this group's override; reporting only, so nothing reaches the gateway. */
export function saveGroupResolver(request: ApiRequest, groupId: string, url: string) {
  return request(`/api/v1/groups/${groupId}/resolver`, { method: "PUT", body: { url: url.trim() } });
}

/** Returns this group to the household resolver. */
export function removeGroupResolver(request: ApiRequest, groupId: string) {
  return request(`/api/v1/groups/${groupId}/resolver`, { method: "DELETE" });
}
