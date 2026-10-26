/**
 * Leftover policies: Checkup lists gateway policies named with FamilyFi's prefix that no record
 * claims, and deletes one only when an administrator ticks it and confirms. The name only decides
 * what is offered; sync never deletes one on its own, and the guard allows only that confirmed delete.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PolicyOperationIntent } from "@prisma/client";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as getCheckup } from "@/app/api/v1/checkup/route";
import { POST as removeLeftovers } from "@/app/api/v1/checkup/leftover-policies/remove/route";
import type { CheckupState, LeftoverRemoval } from "@/lib/checkup";
import { runCheckup } from "@/server/checkup";
import { prisma } from "@/server/db";
import { runReconcileOnce, setReconcileClientForTests, syncClient } from "@/server/reconciliation";
import { ownershipScope } from "@/server/unifi/connection";
import { DEV_MOCK_ADMIN_POLICY_ID, DEV_MOCK_ROGUE_POLICY_ID, createFixtureUnifiClient } from "@/server/unifi/dev-mock";
import { PolicyOwnershipError } from "@/server/unifi/errors";
import type { MockUnifiClient } from "@/server/unifi/mock";
import { withPolicyOwnership } from "@/server/unifi/policy-ownership";
import { SITE_ID, configureConnectedHousehold, resetDatabase } from "../helpers/db";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";

const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";
const json = { "content-type": "application/json" };

async function signedIn(): Promise<SessionAuth> {
  const response = await login(
    request("/api/v1/auth/login", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ username: "admin", password: PASSWORD, client: "browser" }),
    }),
  );
  expect(response.status).toBe(200);
  return authFromLogin(response);
}

async function checkup(auth: SessionAuth): Promise<CheckupState> {
  return ((await (await getCheckup(request("/api/v1/checkup", { auth }))).json()) as { checkup: CheckupState }).checkup;
}

function remove(auth: SessionAuth, body: unknown): Promise<Response> {
  return removeLeftovers(request("/api/v1/checkup/leftover-policies/remove", { method: "POST", auth, headers: json, body: JSON.stringify(body) }));
}

async function runCheckupNow() {
  const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
  await runCheckup(household, syncClient(household));
}

const leftoverIds = (state: CheckupState) => state.findings.find((finding) => finding.check === "leftover_policies")?.details.policies?.map((policy) => policy.id) ?? [];
const onGateway = (client: MockUnifiClient, id: string) => client.state.policies.some((policy) => policy.id === id);
const deletes = (client: MockUnifiClient) => client.calls.filter((call) => call.method === "DELETE");

describe("leftover FamilyFi policies", () => {
  let client: MockUnifiClient;

  beforeEach(async () => {
    await resetDatabase();
    await configureConnectedHousehold();
    // The fixture gateway: an administrator's policy, and "FamilyFi Rogue Prefix", which no record claims.
    client = createFixtureUnifiClient({ friendlyNames: true });
    setReconcileClientForTests(client);
  });

  afterEach(() => {
    setReconcileClientForTests(undefined);
  });

  it("lists only unrecorded policies named like FamilyFi's, never its own or an administrator's, and sync leaves them alone", async () => {
    const auth = await signedIn();
    await runReconcileOnce();
    const recorded = (await prisma().appPolicy.findMany()).map((row) => row.unifiPolicyId);
    expect(recorded.length).toBeGreaterThan(0);
    const state = await checkup(auth);
    expect(leftoverIds(state)).toEqual([DEV_MOCK_ROGUE_POLICY_ID]);
    const [rogue] = state.findings.find((finding) => finding.check === "leftover_policies")!.details.policies!;
    expect(rogue).toMatchObject({ name: "FamilyFi Rogue Prefix", enabled: expect.any(Boolean), scheduled: false });
    expect(rogue).not.toHaveProperty("copyOf");
    // Sync passes come and go; the leftover stays until an administrator removes it.
    await runReconcileOnce();
    expect(onGateway(client, DEV_MOCK_ROGUE_POLICY_ID)).toBe(true);
    expect(deletes(client).some((call) => call.path.endsWith(DEV_MOCK_ROGUE_POLICY_ID))).toBe(false);
  });

  it("says when a leftover is an old copy of one of FamilyFi's own policies", async () => {
    const auth = await signedIn();
    await runReconcileOnce();
    const ours = await prisma().appPolicy.findFirstOrThrow({ where: { ownerScope: "quarantine" } });
    const name = client.state.policies.find((policy) => policy.id === ours.unifiPolicyId)!.name;
    client.state.policies.find((policy) => policy.id === DEV_MOCK_ROGUE_POLICY_ID)!.name = name;
    await runCheckupNow();
    const [rogue] = (await checkup(auth)).findings.find((finding) => finding.check === "leftover_policies")!.details.policies!;
    expect(rogue).toMatchObject({ id: DEV_MOCK_ROGUE_POLICY_ID, copyOf: "Quarantine" });
  });

  it("removes a confirmed leftover, records it, and the finding goes", async () => {
    const auth = await signedIn();
    await runReconcileOnce();
    const response = await remove(auth, { policyIds: [DEV_MOCK_ROGUE_POLICY_ID] });
    expect(response.status).toBe(200);
    const result = (await response.json()) as LeftoverRemoval;
    expect(result.removed).toEqual([DEV_MOCK_ROGUE_POLICY_ID]);
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(onGateway(client, DEV_MOCK_ROGUE_POLICY_ID)).toBe(false);
    expect(leftoverIds(result.checkup)).toEqual([]);
    expect(result.checkup.passed).toContain("leftover_policies");
    const operation = await prisma().policyOperation.findFirstOrThrow({ where: { intent: PolicyOperationIntent.delete, unifiPolicyId: DEV_MOCK_ROGUE_POLICY_ID } });
    // Spent: it allows no further delete.
    expect(operation.status).toBe("removed");
  });

  it("skips, and never deletes, an administrator's policy, FamilyFi's own, a renamed one or one that is gone", async () => {
    const auth = await signedIn();
    await runReconcileOnce();
    const ours = (await prisma().appPolicy.findFirstOrThrow()).unifiPolicyId!;
    client.state.policies.find((policy) => policy.id === DEV_MOCK_ROGUE_POLICY_ID)!.name = "Renamed by hand";
    const before = deletes(client).length;
    const response = await remove(auth, { policyIds: [DEV_MOCK_ADMIN_POLICY_ID, ours, DEV_MOCK_ROGUE_POLICY_ID, "no-such-policy"] });
    expect(response.status).toBe(200);
    const result = (await response.json()) as LeftoverRemoval;
    expect(result.removed).toEqual([]);
    expect(result.skipped).toEqual([DEV_MOCK_ADMIN_POLICY_ID, ours, DEV_MOCK_ROGUE_POLICY_ID, "no-such-policy"]);
    expect(deletes(client).length).toBe(before);
    expect(await prisma().policyOperation.count({ where: { intent: PolicyOperationIntent.delete } })).toBe(0);
  });

  it("removes only the ticked leftovers, and reports one the gateway would not delete", async () => {
    const auth = await signedIn();
    await runReconcileOnce();
    const rogue = client.state.policies.find((policy) => policy.id === DEV_MOCK_ROGUE_POLICY_ID)!;
    for (const [id, name] of [["leftover-kept", "FamilyFi Kept"], ["leftover-stuck", "FamilyFi Stuck"]]) client.state.policies.push({ ...rogue, id, name });
    const deleteOne = client.deletePolicy.bind(client);
    client.deletePolicy = async (siteId, policyId) => {
      if (policyId === "leftover-stuck") throw new Error("gateway busy");
      return deleteOne(siteId, policyId);
    };
    const result = (await (await remove(auth, { policyIds: [DEV_MOCK_ROGUE_POLICY_ID, "leftover-stuck"] })).json()) as LeftoverRemoval;
    expect(result).toMatchObject({ removed: [DEV_MOCK_ROGUE_POLICY_ID], skipped: [], failed: ["leftover-stuck"] });
    // The unticked one was never sent a delete, and both left are still listed.
    expect(deletes(client).some((call) => call.path.endsWith("leftover-kept"))).toBe(false);
    expect(leftoverIds(result.checkup)).toEqual(["leftover-kept", "leftover-stuck"]);
    const stuck = await prisma().policyOperation.findFirstOrThrow({ where: { intent: PolicyOperationIntent.delete, unifiPolicyId: "leftover-stuck" } });
    expect(stuck.status).toBe("failed");
  });

  it("does not list a policy a pending create may have made", async () => {
    const auth = await signedIn();
    await runReconcileOnce();
    const rogue = client.state.policies.find((policy) => policy.id === DEV_MOCK_ROGUE_POLICY_ID)!;
    const scope = ownershipScope(await prisma().household.findUniqueOrThrow({ where: { id: "default" } }));
    await prisma().policyOperation.create({
      data: { intent: PolicyOperationIntent.create, status: "pending", connectionIdentity: scope.connectionIdentity, siteId: SITE_ID, payload: JSON.parse(JSON.stringify({ name: rogue.name, enabled: rogue.enabled, action: rogue.action, source: rogue.source, destination: rogue.destination })) },
    });
    const response = await remove(auth, { policyIds: [DEV_MOCK_ROGUE_POLICY_ID] });
    const result = (await response.json()) as LeftoverRemoval;
    expect(result.skipped).toEqual([DEV_MOCK_ROGUE_POLICY_ID]);
    expect(leftoverIds(result.checkup)).toEqual([]);
    expect(onGateway(client, DEV_MOCK_ROGUE_POLICY_ID)).toBe(true);
  });

  it("lets a confirmation allow only its own delete, never an update", async () => {
    const scope = ownershipScope(await prisma().household.findUniqueOrThrow({ where: { id: "default" } }));
    const guarded = withPolicyOwnership(client, scope);
    const rogue = await client.getPolicy(SITE_ID, DEV_MOCK_ROGUE_POLICY_ID);
    await prisma().policyOperation.create({
      data: { intent: PolicyOperationIntent.delete, status: "confirmed", connectionIdentity: scope.connectionIdentity, siteId: SITE_ID, unifiPolicyId: rogue.id },
    });
    await expect(guarded.updatePolicy(SITE_ID, rogue.id, { ...rogue, enabled: false })).rejects.toThrow(PolicyOwnershipError);
    await expect(guarded.deletePolicy(SITE_ID, DEV_MOCK_ADMIN_POLICY_ID)).rejects.toThrow(PolicyOwnershipError);
    // Another console or site's confirmation counts for nothing here.
    await expect(withPolicyOwnership(client, { ...scope, connectionIdentity: "local:elsewhere" }).deletePolicy(SITE_ID, rogue.id)).rejects.toThrow(PolicyOwnershipError);
    await expect(withPolicyOwnership(client, { ...scope, siteId: "another-site" }).deletePolicy("another-site", rogue.id)).rejects.toThrow(PolicyOwnershipError);
    await guarded.deletePolicy(SITE_ID, rogue.id);
    expect(onGateway(client, rogue.id)).toBe(false);
  });

  it("lets a confirmation an earlier removal left behind allow nothing once another removal starts", async () => {
    const auth = await signedIn();
    await runReconcileOnce();
    const scope = ownershipScope(await prisma().household.findUniqueOrThrow({ where: { id: "default" } }));
    // A removal that stopped between recording its confirmation and deleting.
    await prisma().policyOperation.create({
      data: { intent: PolicyOperationIntent.delete, status: "confirmed", connectionIdentity: scope.connectionIdentity, siteId: SITE_ID, unifiPolicyId: "stale-confirmation" },
    });
    await remove(auth, { policyIds: ["no-such-policy"] });
    expect((await prisma().policyOperation.findFirstOrThrow({ where: { unifiPolicyId: "stale-confirmation" } })).status).toBe("failed");
  });

  it("never lets a sync pass, or a confirmation older than its removal, delete on a confirmation's strength", async () => {
    const scope = ownershipScope(await prisma().household.findUniqueOrThrow({ where: { id: "default" } }));
    const guarded = withPolicyOwnership(client, scope);
    const confirmation = { intent: PolicyOperationIntent.delete, status: "confirmed", connectionIdentity: scope.connectionIdentity, siteId: SITE_ID, unifiPolicyId: DEV_MOCK_ROGUE_POLICY_ID };
    // Older than any removal lasts.
    await prisma().policyOperation.create({ data: { ...confirmation, createdAt: new Date(Date.now() - 3 * 60_000) } });
    await expect(guarded.deletePolicy(SITE_ID, DEV_MOCK_ROGUE_POLICY_ID)).rejects.toThrow(PolicyOwnershipError);
    // Fresh, but left behind: the next sync pass fails it before it writes anything.
    const fresh = await prisma().policyOperation.create({ data: confirmation });
    await runReconcileOnce();
    expect((await prisma().policyOperation.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe("failed");
    await expect(guarded.deletePolicy(SITE_ID, DEV_MOCK_ROGUE_POLICY_ID)).rejects.toThrow(PolicyOwnershipError);
    expect(onGateway(client, DEV_MOCK_ROGUE_POLICY_ID)).toBe(true);
  });

  it("answers 400 without policies and 409 before UniFi is set up", async () => {
    const auth = await signedIn();
    expect((await remove(auth, { policyIds: [] })).status).toBe(400);
    expect((await remove(auth, {})).status).toBe(400);
    await prisma().household.update({ where: { id: "default" }, data: { connectionStatus: "unconfigured", unifiSiteId: null } });
    expect((await remove(auth, { policyIds: [DEV_MOCK_ROGUE_POLICY_ID] })).status).toBe(409);
  });
});
