import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RuleKind, RuleMode, RuleScope } from "@prisma/client";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as listRules, POST as createRule } from "@/app/api/v1/rules/route";
import { DELETE as deleteRule, PATCH as patchRule } from "@/app/api/v1/rules/[id]/route";
import { PUT as putUnifiSettings } from "@/app/api/v1/settings/unifi/route";
import { prisma } from "@/server/db";
import { pruneNetworkScopedRulesForScope } from "@/server/network-rules";
import { runReconcileOnce, setReconcileClientForTests } from "@/server/reconciliation";
import { authFromLogin, request } from "../helpers/http";
import {
  INTERNAL_NETWORK,
  INTERNAL_ZONE,
  IOT_NETWORK,
  configureConnectedHousehold,
  resetDatabase,
} from "../helpers/db";
import { fixtureUnifiClient } from "../helpers/unifi-world";

const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";

async function signedIn() {
  const response = await login(
    request("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: PASSWORD, client: "browser" }),
    }),
  );
  expect(response.status).toBe(200);
  return authFromLogin(response);
}

async function withMockKey() {
  await prisma().household.update({
    where: { id: "default" },
    data: {
      unifiKeyCiphertext: Buffer.from("x"),
      unifiKeyIv: Buffer.from("y"),
      unifiKeyAuthTag: Buffer.from("z"),
      unifiKeyLastFour: "mock",
    },
  });
  process.env.FAMILYFI_UNIFI_MOCK = "1";
}

describe("Phase 3 network-scoped DPI", () => {
  beforeEach(async () => {
    await resetDatabase();
    await configureConnectedHousehold({
      manageAllNetworks: false,
      managedNetworkIds: [INTERNAL_NETWORK],
    });
    await withMockKey();
  });

  afterEach(() => {
    setReconcileClientForTests(undefined);
  });

  it("requires auth for network-scoped rule create", async () => {
    expect(
      (
        await createRule(
          request("/api/v1/rules", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              kind: "category",
              scope: "network",
              networkIds: [INTERNAL_NETWORK],
              targetIds: [4],
            }),
          }),
        )
      ).status,
    ).toBe(401);
  });

  it("rejects unmanaged network ids and empty managed list", async () => {
    const auth = await signedIn();
    const unmanaged = await createRule(
      request("/api/v1/rules", {
        method: "POST",
        auth,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "category",
          scope: "network",
          networkIds: [IOT_NETWORK],
          targetIds: [4],
        }),
      }),
    );
    expect(unmanaged.status).toBe(400);
    const body = (await unmanaged.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("unmanaged_network");

    await prisma().household.update({
      where: { id: "default" },
      data: { unifiManageAllNetworks: false, unifiManagedNetworkIds: [] },
    });
    const empty = await createRule(
      request("/api/v1/rules", {
        method: "POST",
        auth,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "category",
          scope: "network",
          networkIds: [INTERNAL_NETWORK],
          targetIds: [4],
        }),
      }),
    );
    expect(empty.status).toBe(409);
    expect(((await empty.json()) as { error?: { code?: string } }).error?.code).toBe("empty_managed_networks");
  });

  it("reconcile CUD asserts NETWORK source body; update/delete work", async () => {
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    const auth = await signedIn();

    const created = await createRule(
      request("/api/v1/rules", {
        method: "POST",
        auth,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "category",
          scope: "network",
          networkIds: [INTERNAL_NETWORK],
          targetIds: [4],
          mode: "always",
        }),
      }),
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      rule: { id: string; scope: string; networkIds: string[]; groupId: string | null };
    };
    expect(createdBody.rule.scope).toBe("network");
    expect(createdBody.rule.groupId).toBeNull();
    expect(createdBody.rule.networkIds).toEqual([INTERNAL_NETWORK]);

    expect(await runReconcileOnce()).toBe(true);
    const createCall = client.calls.find(
      (call) =>
        call.method === "POST" &&
        (call.body as { source?: { trafficFilter?: { type?: string } } })?.source?.trafficFilter?.type === "NETWORK",
    );
    expect(createCall).toBeTruthy();
    const createBody = createCall!.body as {
      enabled: boolean;
      source: {
        zoneId: string;
        trafficFilter: { type: string; networkFilter: { matchOpposite: boolean; networkIds: string[] } };
      };
      destination: {
        trafficFilter: { type: string; applicationCategoryFilter: { applicationCategoryIds: number[] } };
      };
      schedule?: unknown;
    };
    expect(createBody.source.trafficFilter.type).toBe("NETWORK");
    expect(createBody.source.trafficFilter.networkFilter.matchOpposite).toBe(false);
    expect(createBody.source.trafficFilter.networkFilter.networkIds).toEqual([INTERNAL_NETWORK]);
    expect(createBody.source.zoneId).toBe(INTERNAL_ZONE);
    expect(createBody.destination.trafficFilter.type).toBe("APPLICATION_CATEGORY");
    expect(createBody.destination.trafficFilter.applicationCategoryFilter.applicationCategoryIds).toEqual([4]);
    expect(createBody.schedule).toBeUndefined();

    const ownership = await prisma().rulePolicy.findFirst({ where: { ruleId: createdBody.rule.id } });
    expect(ownership?.unifiPolicyId).toBeTruthy();

    const patched = await patchRule(
      request(`/api/v1/rules/${createdBody.rule.id}`, {
        method: "PATCH",
        auth,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetIds: [24] }),
      }),
      { params: Promise.resolve({ id: createdBody.rule.id }) },
    );
    expect(patched.status).toBe(200);

    const deleted = await deleteRule(
      request(`/api/v1/rules/${createdBody.rule.id}`, { method: "DELETE", auth }),
      { params: Promise.resolve({ id: createdBody.rule.id }) },
    );
    expect(deleted.status).toBe(200);
    expect(await prisma().rule.count()).toBe(0);
  });

  it("Settings descope prunes network ids and deletes orphan rules (no silent desired-state orphan)", async () => {
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);

    await prisma().household.update({
      where: { id: "default" },
      data: {
        unifiManageAllNetworks: false,
        unifiManagedNetworkIds: [INTERNAL_NETWORK, IOT_NETWORK],
      },
    });

    const rule = await prisma().rule.create({
      data: {
        kind: RuleKind.category,
        scope: RuleScope.network,
        groupId: null,
        networkIds: [INTERNAL_NETWORK, IOT_NETWORK],
        targetIds: [8],
        enabled: true,
        mode: RuleMode.always,
      },
    });
    const orphanOnly = await prisma().rule.create({
      data: {
        kind: RuleKind.app,
        scope: RuleScope.network,
        groupId: null,
        networkIds: [IOT_NETWORK],
        targetIds: [10001],
        enabled: true,
        mode: RuleMode.always,
      },
    });

    // Simulate Settings narrowing managed list to INTERNAL only.
    const scope = { manageAllNetworks: false, managedNetworkIds: [INTERNAL_NETWORK] };
    await prisma().household.update({
      where: { id: "default" },
      data: {
        unifiManageAllNetworks: false,
        unifiManagedNetworkIds: [INTERNAL_NETWORK],
      },
    });
    const result = await pruneNetworkScopedRulesForScope(scope);
    expect(result.pruned).toBe(1);
    expect(result.deleted).toBe(1);

    const kept = await prisma().rule.findUnique({ where: { id: rule.id } });
    expect(kept?.networkIds).toEqual([INTERNAL_NETWORK]);
    expect(await prisma().rule.findUnique({ where: { id: orphanOnly.id } })).toBeNull();

    // Also assert Settings PUT path invokes prune (via saveManagedNetworks).
    const auth = await signedIn();
    await prisma().rule.create({
      data: {
        kind: RuleKind.category,
        scope: RuleScope.network,
        networkIds: [INTERNAL_NETWORK],
        targetIds: [4],
        enabled: true,
        mode: RuleMode.always,
      },
    });
    const put = await putUnifiSettings(
      request("/api/v1/settings/unifi", {
        method: "PUT",
        auth,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manageAllNetworks: false, managedNetworkIds: [] }),
      }),
    );
    expect(put.status).toBe(200);
    expect(await prisma().rule.count({ where: { scope: RuleScope.network } })).toBe(0);
  });

  it("lists network rules alongside group rules", async () => {
    const auth = await signedIn();
    await prisma().rule.create({
      data: {
        kind: RuleKind.category,
        scope: RuleScope.network,
        networkIds: [INTERNAL_NETWORK],
        targetIds: [4],
        enabled: true,
        mode: RuleMode.always,
      },
    });
    const listed = await listRules(request("/api/v1/rules", { auth }));
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { rules: { scope: string; networkIds: string[] }[] };
    expect(body.rules.some((r) => r.scope === "network" && r.networkIds.includes(INTERNAL_NETWORK))).toBe(true);
  });
});
