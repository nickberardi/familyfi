import { describe, expect, it, vi } from "vitest";
import {
  GROUP_RESOLVER_COPY,
  canSaveGroupResolver,
  groupResolverNetworkLine,
  groupResolverSummary,
  loadGroupResolver,
  removeGroupResolver,
  saveGroupResolver,
} from "@/lib/group-resolver";

describe("group resolver", () => {
  it("says where a group without an override is measured", () => {
    expect(groupResolverSummary(null)).toBe("Resolver information is unavailable.");
    expect(groupResolverSummary({ source: "dhcp", networks: [], reason: null })).toContain("UniFi DHCP");
    expect(groupResolverSummary({ source: "unknown", networks: [], reason: "No devices assigned." })).toBe("No devices assigned.");
    // An empty reason says nothing, so the default sentence stands in for it.
    expect(groupResolverSummary({ source: "unknown", networks: [], reason: "" })).toBe("Resolver information is unavailable.");
    expect(GROUP_RESOLVER_COPY.fieldLabel("A child")).toBe("DNS-over-HTTPS endpoint for A child");
    expect(GROUP_RESOLVER_COPY.overrideNote("A child")).toMatch(/^DNS-over-HTTPS override for A child\. /);
    expect(groupResolverNetworkLine({ id: "n", name: "Kids", servers: ["192.0.2.1", "192.0.2.2"], reason: null })).toBe("Kids: 192.0.2.1, 192.0.2.2");
  });

  it("sends an endpoint only once it is longer than https://", () => {
    expect(canSaveGroupResolver(" https:// ")).toBe(false);
    expect(canSaveGroupResolver("https://d")).toBe(true);
  });

  it("loads, sets and removes the override, and reads a failed load as unknown", async () => {
    const request = vi.fn(async () => ({ resolver: { source: "doh", networks: [], reason: null } }));
    await expect(loadGroupResolver(request as never, "g1")).resolves.toMatchObject({ source: "doh" });
    expect(request).toHaveBeenLastCalledWith("/api/v1/groups/g1/resolver");
    await saveGroupResolver(request as never, "g1", " https://dns.example/q ");
    expect(request).toHaveBeenLastCalledWith("/api/v1/groups/g1/resolver", { method: "PUT", body: { url: "https://dns.example/q" } });
    await removeGroupResolver(request as never, "g1");
    expect(request).toHaveBeenLastCalledWith("/api/v1/groups/g1/resolver", { method: "DELETE" });
    await expect(loadGroupResolver((async () => Promise.reject(new Error("x"))) as never, "g1")).resolves.toBeNull();
  });
});
