/**
 * AGENTS.md: FamilyFi does not create UniFi Object Manager groups. This calls every
 * public method and checks its write surface: owned firewall policies, guest client
 * actions, and hotspot vouchers.
 */

import { describe, expect, it } from "vitest";
import { HttpUnifiClient } from "@/server/unifi/client";
import { MockUnifiClient, createMockUnifiState } from "@/server/unifi/mock";

const BASE = "https://10.0.0.1/proxy/network/integration";
const SITE = "11111111-1111-4111-8111-111111111111";
const POLICIES = new RegExp(`^/v1/sites/${SITE}/firewall/policies(/[^/]+)?$`);

describe("UniFi client write surface", () => {
  it("writes only firewall policies, guest actions, and hotspot vouchers", async () => {
    const requests: { method: string; path: string }[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push({ method: init?.method ?? "GET", path: url.pathname.replace(new URL(BASE).pathname, "") });
      const body = { data: [], count: 0, offset: 0, limit: 200, totalCount: 0, id: "x", enabled: true, vouchersDeleted: 1,
        vouchers: [{ id: "voucher-id", code: "1234567890", createdAt: "2026-09-27T12:00:00Z", timeLimitMinutes: 120, authorizedGuestCount: 0, expired: false }] };
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
    expect(writes.map((write) => `${write.method} ${write.path}`).sort()).toEqual([
      `DELETE /v1/sites/${SITE}/firewall/policies/policy-id`,
      `DELETE /v1/sites/${SITE}/hotspot/vouchers/policy-id`,
      `POST /v1/sites/${SITE}/clients/policy-id/actions`,
      `POST /v1/sites/${SITE}/clients/policy-id/actions`,
      `POST /v1/sites/${SITE}/firewall/policies`,
      `POST /v1/sites/${SITE}/hotspot/vouchers`,
      `PUT /v1/sites/${SITE}/firewall/policies/policy-id`,
    ].sort());
    for (const write of writes.filter((item) => item.path.includes("/firewall/policies"))) {
      expect(write.path, `${write.method} ${write.path}`).toMatch(POLICIES);
    }
    for (const request of requests) {
      expect(request.path, `${request.method} ${request.path}`).not.toMatch(/object|firewall-group|\/groups/i);
    }
  });

  it("returns the created voucher and refuses to unauthorize a guest without access", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ vouchers: [{ id: "voucher-id", code: "1234567890" }] }), { status: 201 })) as typeof fetch;
    const http = new HttpUnifiClient({ apiKey: "surface-test-key", baseUrl: BASE, fetchImpl });
    expect(await http.createVoucher(SITE, 120)).toMatchObject({ id: "voucher-id", code: "1234567890" });
    const mock = new MockUnifiClient(createMockUnifiState({
      clients: [{ id: "visitor", name: "Visitor", type: "WIRELESS", access: { type: "GUEST", authorized: false } }],
    }));
    await expect(mock.unauthorizeGuest(SITE, "visitor")).rejects.toMatchObject({ status: 400 });
  });

  it("reads the confirmed voucher deletion count", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ vouchersDeleted: 0 }), { status: 200 })) as typeof fetch;
    const http = new HttpUnifiClient({ apiKey: "surface-test-key", baseUrl: BASE, fetchImpl });
    expect(await http.deleteVoucher(SITE, "voucher-id")).toBe(0);
  });
});
