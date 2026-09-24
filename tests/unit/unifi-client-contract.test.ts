/**
 * The behaviour FamilyFi relies on from the UniFi Integration API, checked the same way
 * against the mock every other test uses and against the real `HttpUnifiClient`. The
 * HTTP side answers as the API is documented (docs/architecture.md) and as the spike saw
 * it on a live console: 404 for an id it does not have, PUT replacing the whole policy,
 * and an ordering read that needs a source zone. The mock used to throw plain errors,
 * merge on PUT and ignore the zone, so reconcile's recreate-on-404 path could never run
 * in a test; this keeps the two from drifting apart again.
 *
 * The cases themselves live in `src/server/unifi/contract-cases.ts`, so `pnpm spike verify`
 * can run the same contract against a real console.
 */

import { describe, expect, it } from "vitest";
import { HttpUnifiClient, type UnifiClient } from "@/server/unifi/client";
import { UNIFI_CLIENT_CONTRACT } from "@/server/unifi/contract-cases";
import {
  createFixtureUnifiClient,
  DEV_MOCK_ADMIN_POLICY_ID,
  DEV_MOCK_INTERNAL_ZONE,
  DEV_MOCK_SITE_ID,
} from "@/server/unifi/dev-mock";
import type { FirewallPolicy, FirewallPolicyWrite } from "@/server/unifi/types";

const SITE = DEV_MOCK_SITE_ID;
const EXTERNAL_ZONE = "33333333-3333-4333-8333-333333333335";
const BASE = "https://10.0.0.1/proxy/network/integration";

/** An in-memory Integration API behind `fetch`, answering the requests this suite makes. */
function httpClient(): UnifiClient {
  // The same starting gateway as the mock: the fixture's policies and ordering.
  const fixture = createFixtureUnifiClient().state;
  const policies = new Map<string, FirewallPolicy>(fixture.policies.map((policy) => [policy.id, structuredClone(policy)]));
  const ordering: string[] = [...fixture.ordering.afterSystemDefined];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const notFound = () => json(404, { statusCode: 404, statusName: "NOT_FOUND", message: "Not Found" });
  let created = 0;

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = url.pathname.replace(new URL(BASE).pathname, "");
    const body = init?.body ? (JSON.parse(String(init.body)) as FirewallPolicyWrite) : undefined;
    const policiesPath = `/v1/sites/${SITE}/firewall/policies`;
    if (path === `${policiesPath}/ordering` && method === "GET") {
      const zone = url.searchParams.get("sourceFirewallZoneId");
      if (!zone) return json(400, { statusCode: 400, message: "sourceFirewallZoneId is required" });
      const inZone = ordering.filter((id) => policies.get(id)?.source.zoneId === zone);
      return json(200, { beforeSystemDefined: [], afterSystemDefined: inZone });
    }
    if (path === policiesPath && method === "POST") {
      created += 1;
      const policy: FirewallPolicy = { ...body!, id: `00000000-0000-4000-8000-00000000000${created}`, index: 100 + created, metadata: { origin: "USER_DEFINED" } };
      policies.set(policy.id, policy);
      ordering.push(policy.id);
      return json(201, policy);
    }
    const id = path.startsWith(`${policiesPath}/`) ? path.slice(policiesPath.length + 1) : null;
    const current = id ? policies.get(id) : undefined;
    if (id && !current) return notFound();
    if (id && method === "GET") return json(200, current);
    if (id && method === "PUT") {
      const next: FirewallPolicy = { ...body!, id: current!.id, index: current!.index, metadata: current!.metadata };
      policies.set(id, next);
      return json(200, next);
    }
    if (id && method === "DELETE") {
      policies.delete(id);
      return new Response(null, { status: 204 });
    }
    return notFound();
  }) as typeof fetch;

  return new HttpUnifiClient({ apiKey: "contract-test-key", baseUrl: BASE, fetchImpl });
}

const subjects: [string, () => UnifiClient][] = [
  ["MockUnifiClient", () => createFixtureUnifiClient()],
  ["HttpUnifiClient", httpClient],
];

describe.each(subjects)("UniFi client contract: %s", (_name, make) => {
  // The shared cases: `pnpm spike verify` runs these same ones against a real console.
  for (const contractCase of UNIFI_CLIENT_CONTRACT) {
    it(contractCase.name, () =>
      contractCase.run({ client: make(), siteId: SITE, sourceZoneId: DEV_MOCK_INTERNAL_ZONE, destinationZoneId: EXTERNAL_ZONE }),
    );
  }

  it("lists the fixture's administrator policy first in its zone, and nothing for External", async () => {
    const client = make();
    const admin = await client.getPolicy(SITE, DEV_MOCK_ADMIN_POLICY_ID);
    const ordering = await client.getPolicyOrdering(SITE, admin.source.zoneId);
    expect(ordering.afterSystemDefined[0]).toBe(admin.id);
    const external = await client.getPolicyOrdering(SITE, EXTERNAL_ZONE);
    expect(external.afterSystemDefined).toEqual([]);
  });
});
