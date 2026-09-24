/**
 * AGENTS.md: FamilyFi does not create UniFi Object Manager groups, and writes nothing on
 * the console but its own firewall policies. This calls every public method of the real
 * client and checks the only writes it can make are to firewall policies, so a new
 * method that writes anywhere else fails here before it reaches a gateway.
 */

import { describe, expect, it } from "vitest";
import { HttpUnifiClient } from "@/server/unifi/client";

const BASE = "https://10.0.0.1/proxy/network/integration";
const SITE = "11111111-1111-4111-8111-111111111111";
const POLICIES = new RegExp(`^/v1/sites/${SITE}/firewall/policies(/[^/]+)?$`);

describe("UniFi client write surface", () => {
  it("writes only firewall policies, and never touches Object Manager groups", async () => {
    const requests: { method: string; path: string }[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push({ method: init?.method ?? "GET", path: url.pathname.replace(new URL(BASE).pathname, "") });
      const body = { data: [], count: 0, offset: 0, limit: 200, totalCount: 0, id: "x", enabled: true };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const client = new HttpUnifiClient({ apiKey: "surface-test-key", baseUrl: BASE, fetchImpl });

    const methods = Object.getOwnPropertyNames(HttpUnifiClient.prototype).filter(
      (name) => name !== "constructor" && !["paginate", "request"].includes(name),
    );
    expect(methods.length).toBeGreaterThan(10);
    for (const name of methods) {
      const method = (client as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[name];
      await method.call(client, SITE, "policy-id", { name: "x" }).catch(() => undefined);
    }

    const writes = requests.filter((request) => request.method !== "GET");
    expect(writes.map((write) => write.method).sort()).toEqual(["DELETE", "POST", "PUT"]);
    for (const write of writes) expect(write.path, `${write.method} ${write.path}`).toMatch(POLICIES);
    for (const request of requests) {
      expect(request.path, `${request.method} ${request.path}`).not.toMatch(/object|firewall-group|\/groups/i);
    }
  });
});
