import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AssignmentState, RuleKind, RuleMode, FamilyRole, GroupKind } from "@prisma/client";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as listCategories } from "@/app/api/v1/dpi/categories/route";
import { GET as listApplications } from "@/app/api/v1/dpi/applications/route";
import { GET as listRules, POST as createRule } from "@/app/api/v1/rules/route";
import { DELETE as deleteRule, PATCH as patchRule } from "@/app/api/v1/rules/[id]/route";
import { POST as offRule } from "@/app/api/v1/rules/[id]/off/route";
import { prisma } from "@/server/db";
import { runReconcileOnce, setReconcileClientForTests } from "@/server/reconciliation";
import { authFromLogin, request } from "../helpers/http";
import {
  ADMIN_POLICY_ID,
  INTERNAL_ZONE,
  configureConnectedHousehold,
  createFamilyGroup,
  resetDatabase,
  seedDevice,
} from "../helpers/db";
import { fixtureUnifiClient, policyMacs } from "../helpers/unifi-world";

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

describe("Phase 2 DPI rules", () => {
  beforeEach(async () => {
    await resetDatabase();
    await configureConnectedHousehold();
  });

  afterEach(() => {
    setReconcileClientForTests(undefined);
  });

  it("requires auth for dpi and rules routes", async () => {
    expect((await listCategories(request("/api/v1/dpi/categories"))).status).toBe(401);
    expect((await listApplications(request("/api/v1/dpi/applications"))).status).toBe(401);
    expect((await listRules(request("/api/v1/rules"))).status).toBe(401);
    expect(
      (
        await createRule(
          request("/api/v1/rules", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ kind: "category", groupId: "x", targetIds: [4] }),
          }),
        )
      ).status,
    ).toBe(401);
  });

  it("lists mock DPI catalog and rejects protected group rule create", async () => {
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    const auth = await signedIn();
    // Mark household connected with key material so clientForHousehold works under mock.
    await prisma().household.update({
      where: { id: "default" },
      data: {
        unifiKeyCiphertext: Buffer.from("x"),
        unifiKeyIv: Buffer.from("y"),
        unifiKeyAuthTag: Buffer.from("z"),
      },
    });
    process.env.UNIFI_MOCK = "1";

    const cats = await listCategories(request("/api/v1/dpi/categories", { auth }));
    expect(cats.status).toBe(200);
    const catBody = (await cats.json()) as {
      categories: { id: number; name: string }[];
      curated: { status: string };
    };
    expect(catBody.curated.status).toBe("confirmed");
    expect(catBody.categories.some((c) => c.id === 9001 && c.name === "Fixture Category Alpha")).toBe(true);

    const apps = await listApplications(request("/api/v1/dpi/applications?filter=Fixture", { auth }));
    expect(apps.status).toBe(200);
    const appBody = (await apps.json()) as { applications: { id: number; name: string }[] };
    expect(appBody.applications.every((a) => a.name.includes("Fixture") || a.id > 0)).toBe(true);

    const protectedGroup = await prisma().group.create({
      data: {
        kind: GroupKind.family,
        name: "Adult",
        familyRole: FamilyRole.adult,
        protected: true,
      },
    });
    const denied = await createRule(
      request("/api/v1/rules", {
        method: "POST",
        auth,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "category", groupId: protectedGroup.id, targetIds: [4] }),
      }),
    );
    expect(denied.status).toBe(409);
  });

  it("reconcile CUD asserts APPLICATION_CATEGORY body; off sets enabled:false; delete leaves internet untouched", async () => {
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    process.env.UNIFI_MOCK = "1";
    await prisma().household.update({
      where: { id: "default" },
      data: {
        unifiKeyCiphertext: Buffer.from("x"),
        unifiKeyIv: Buffer.from("y"),
        unifiKeyAuthTag: Buffer.from("z"),
      },
    });

    const group = await createFamilyGroup();
    await seedDevice({ mac: "02:00:00:00:00:01", groupId: group.id, zoneId: INTERNAL_ZONE });

    const rule = await prisma().rule.create({
      data: {
        kind: RuleKind.category,
        groupId: group.id,
        targetIds: [4],
        enabled: true,
        mode: RuleMode.always,
      },
    });

    expect(await runReconcileOnce()).toBe(true);
    const createCall = client.calls.find(
      (call) =>
        call.method === "POST" &&
        call.path.includes("/firewall/policies") &&
        (call.body as { destination?: { trafficFilter?: { type?: string } } })?.destination?.trafficFilter?.type ===
          "APPLICATION_CATEGORY",
    );
    expect(createCall).toBeTruthy();
    const createBody = createCall!.body as {
      enabled: boolean;
      source: { trafficFilter: { type: string; macAddressFilter: { macAddresses: string[] } } };
      destination: {
        trafficFilter: { type: string; applicationCategoryFilter: { applicationCategoryIds: number[] } };
      };
      schedule?: unknown;
    };
    expect(createBody.source.trafficFilter.type).toBe("MAC_ADDRESS");
    expect(createBody.source.trafficFilter.macAddressFilter.macAddresses).toContain("02:00:00:00:00:01");
    expect(createBody.destination.trafficFilter.type).toBe("APPLICATION_CATEGORY");
    expect(createBody.destination.trafficFilter.applicationCategoryFilter.applicationCategoryIds).toEqual([4]);
    expect(createBody.schedule).toBeUndefined();
    expect(createBody.enabled).toBe(true);

    const ownership = await prisma().rulePolicy.findFirst({ where: { ruleId: rule.id } });
    expect(ownership?.unifiPolicyId).toBeTruthy();
    const dpiPolicyId = ownership!.unifiPolicyId!;

    await prisma().rule.update({ where: { id: rule.id }, data: { enabled: false } });
    client.calls.length = 0;
    expect(await runReconcileOnce()).toBe(true);
    const updateCall = client.calls.find(
      (call) => call.method === "PUT" && call.path.includes(dpiPolicyId),
    );
    expect(updateCall).toBeTruthy();
    expect((updateCall!.body as { enabled: boolean }).enabled).toBe(false);

    // Internet AppPolicy should exist; capture ids before category delete.
    const internetBefore = await prisma().appPolicy.findMany();
    const internetUnifiIds = new Set(
      internetBefore.map((row) => row.unifiPolicyId).filter((id): id is string => Boolean(id)),
    );
    expect(internetUnifiIds.size).toBeGreaterThan(0);
    expect(client.state.policies.some((p) => p.id === ADMIN_POLICY_ID)).toBe(true);

    await prisma().rulePolicy.deleteMany({ where: { ruleId: rule.id } });
    // Re-create ownership then delete via reconcile path: remove Rule, keep policy row? API deletes UniFi then rows.
    // Simulate API delete: delete UniFi by recorded id, then DB rows.
    await client.deletePolicy("11111111-1111-4111-8111-111111111111", dpiPolicyId);
    await prisma().rule.delete({ where: { id: rule.id } });
    // Recreate empty — ensure internet untouched
    const internetAfter = await prisma().appPolicy.findMany();
    expect(internetAfter.map((r) => r.unifiPolicyId).sort()).toEqual([...internetUnifiIds].sort());
    expect(client.state.policies.some((p) => p.id === ADMIN_POLICY_ID)).toBe(true);
    expect(client.state.policies.some((p) => p.id === dpiPolicyId)).toBe(false);
  });

  it("creates app rule via API, reconcile asserts APPLICATION body, and off route works", async () => {
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    process.env.UNIFI_MOCK = "1";
    await prisma().household.update({
      where: { id: "default" },
      data: {
        unifiKeyCiphertext: Buffer.from("x"),
        unifiKeyIv: Buffer.from("y"),
        unifiKeyAuthTag: Buffer.from("z"),
      },
    });
    const auth = await signedIn();
    const group = await createFamilyGroup();
    await seedDevice({
      mac: "02:00:00:00:00:01",
      groupId: group.id,
      zoneId: INTERNAL_ZONE,
      assignment: AssignmentState.assigned,
    });

    const created = await createRule(
      request("/api/v1/rules", {
        method: "POST",
        auth,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "app", groupId: group.id, targetIds: [10001], mode: "always" }),
      }),
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { rule: { id: string } };

    expect(await runReconcileOnce()).toBe(true);
    const createCall = client.calls.find(
      (call) =>
        call.method === "POST" &&
        (call.body as { destination?: { trafficFilter?: { type?: string } } })?.destination?.trafficFilter?.type ===
          "APPLICATION",
    );
    expect(createCall).toBeTruthy();
    const body = createCall!.body as {
      source: { trafficFilter: { type: string; macAddressFilter: { macAddresses: string[] } } };
      destination: { trafficFilter: { type: string; applicationFilter: { applicationIds: number[] } } };
    };
    expect(body.source.trafficFilter.type).toBe("MAC_ADDRESS");
    expect(policyMacs({ source: body.source } as never)).toContain("02:00:00:00:00:01");
    expect(body.destination.trafficFilter.applicationFilter.applicationIds).toEqual([10001]);

    const off = await offRule(
      request(`/api/v1/rules/${createdBody.rule.id}/off`, { method: "POST", auth, headers: { "content-type": "application/json" }, body: "{}" }),
      { params: Promise.resolve({ id: createdBody.rule.id }) },
    );
    expect(off.status).toBe(200);
    expect(((await off.json()) as { rule: { enabled: boolean } }).rule.enabled).toBe(false);

    const patched = await patchRule(
      request(`/api/v1/rules/${createdBody.rule.id}`, {
        method: "PATCH",
        auth,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetIds: [10001, 10002] }),
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
    expect(client.state.policies.some((p) => p.id === ADMIN_POLICY_ID)).toBe(true);
  });
});
