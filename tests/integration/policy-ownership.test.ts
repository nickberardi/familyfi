import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PolicyOperationIntent, PolicyOwnerScope, Prisma, RuleKind, type Household } from "@prisma/client";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { PUT as putUnifiSettings } from "@/app/api/v1/settings/unifi/route";
import { prisma } from "@/server/db";
import { setReconcileLockForTests } from "@/server/reconciliation";
import { saveUnifiConnection } from "@/server/unifi-settings";
import { clientForHousehold, connectionIdentity, ownershipScope } from "@/server/unifi/connection";
import {
  DEV_MOCK_ADMIN_POLICY_ID,
  DEV_MOCK_API_KEY,
  DEV_MOCK_BASE_URL,
  DEV_MOCK_ROGUE_POLICY_ID,
  getSharedDevMockClient,
  resetDevMockClientForTests,
} from "@/server/unifi/dev-mock";
import { PolicyOwnershipError, PreviousTargetError, UnifiHttpError } from "@/server/unifi/errors";
import { internetBlockPolicy } from "@/server/unifi/payloads";
import { withPolicyOwnership } from "@/server/unifi/policy-ownership";
import type { FirewallPolicy } from "@/server/unifi/types";
import { INTERNAL_ZONE, SITE_ID, configureConnectedHousehold, resetDatabase } from "../helpers/db";
import { authFromLogin, request } from "../helpers/http";
import { fixtureUnifiClient } from "../helpers/unifi-world";

const EXTERNAL_ZONE = "33333333-3333-4333-8333-333333333399";

async function household(): Promise<Household> {
  return prisma().household.findUniqueOrThrow({ where: { id: "default" } });
}

function blockPolicy(name = "Kids bedtime") {
  return internetBlockPolicy({
    name,
    sourceZoneId: INTERNAL_ZONE,
    destinationZoneId: EXTERNAL_ZONE,
    macAddresses: ["02:00:00:00:00:01"],
  });
}

const writes = (client: ReturnType<typeof fixtureUnifiClient>) =>
  client.calls.filter((call) => call.method === "PUT" || call.method === "DELETE");

describe("policy ownership guard", () => {
  let client: ReturnType<typeof fixtureUnifiClient>;
  let admin: FirewallPolicy;

  beforeEach(async () => {
    await resetDatabase();
    await configureConnectedHousehold();
    client = fixtureUnifiClient();
    admin = await client.getPolicy(SITE_ID, DEV_MOCK_ADMIN_POLICY_ID);
  });

  it("refuses to update or delete an administrator's policy and sends nothing", async () => {
    const guarded = withPolicyOwnership(client, ownershipScope(await household()));
    await expect(guarded.updatePolicy(SITE_ID, admin.id, { ...admin, enabled: false })).rejects.toThrow(PolicyOwnershipError);
    await expect(guarded.deletePolicy(SITE_ID, admin.id)).rejects.toThrow(PolicyOwnershipError);
    expect(writes(client)).toEqual([]);
    expect(client.state.policies.find((policy) => policy.id === admin.id)?.enabled).toBe(admin.enabled);
  });

  it("refuses an administrator's policy while it has others of its own on record", async () => {
    // Evidence is per policy id: owning some policies must not make every id ours.
    const scope = ownershipScope(await household());
    const guarded = withPolicyOwnership(client, scope);
    const onRecord = { connectionIdentity: scope.connectionIdentity, siteId: SITE_ID, zoneId: INTERNAL_ZONE, desiredFingerprint: "test", desiredRevision: 1 };
    const ours = await guarded.createPolicy(SITE_ID, blockPolicy());
    await prisma().appPolicy.create({
      data: { ...onRecord, unifiPolicyId: ours.id, ownerScope: PolicyOwnerScope.quarantine, ipVersion: "dual" },
    });
    const forRule = await guarded.createPolicy(SITE_ID, blockPolicy());
    const rule = await prisma().rule.create({ data: { name: "Rule", kind: RuleKind.category, targetIds: [1] } });
    await prisma().rulePolicy.create({ data: { ...onRecord, ruleId: rule.id, unifiPolicyId: forRule.id } });
    const justCreated = await guarded.createPolicy(SITE_ID, blockPolicy());
    await prisma().policyOperation.create({
      data: {
        intent: PolicyOperationIntent.create,
        connectionIdentity: scope.connectionIdentity,
        siteId: SITE_ID,
        unifiPolicyId: justCreated.id,
        status: "applied",
      },
    });

    await expect(guarded.updatePolicy(SITE_ID, admin.id, { ...admin, enabled: false })).rejects.toThrow(PolicyOwnershipError);
    await expect(guarded.deletePolicy(SITE_ID, admin.id)).rejects.toThrow(PolicyOwnershipError);
    expect(writes(client)).toEqual([]);
  });

  it("does not take a policy for ours because of its name", async () => {
    const guarded = withPolicyOwnership(client, ownershipScope(await household()));
    const rogue = await client.getPolicy(SITE_ID, DEV_MOCK_ROGUE_POLICY_ID);
    expect(rogue.name.startsWith("FamilyFi ")).toBe(true);
    await expect(guarded.deletePolicy(SITE_ID, rogue.id)).rejects.toThrow(PolicyOwnershipError);
    expect(writes(client)).toEqual([]);
  });

  it("writes a policy it has on record, whatever that policy is named", async () => {
    const scope = ownershipScope(await household());
    const guarded = withPolicyOwnership(client, scope);
    // Creating is never refused: the id is recorded once UniFi returns it.
    const created = await guarded.createPolicy(SITE_ID, blockPolicy("Any name at all"));
    await prisma().appPolicy.create({
      data: {
        connectionIdentity: scope.connectionIdentity,
        siteId: SITE_ID,
        unifiPolicyId: created.id,
        ownerScope: PolicyOwnerScope.quarantine,
        zoneId: INTERNAL_ZONE,
        ipVersion: "dual",
        desiredFingerprint: "test",
        desiredRevision: 1,
      },
    });
    await guarded.updatePolicy(SITE_ID, created.id, { ...blockPolicy("Renamed by a parent"), enabled: false });
    expect((await client.getPolicy(SITE_ID, created.id)).enabled).toBe(false);
    await guarded.deletePolicy(SITE_ID, created.id);
    expect(client.state.policies.some((policy) => policy.id === created.id)).toBe(false);
  });

  it("accepts a DPI rule's record and an applied create operation as evidence", async () => {
    const scope = ownershipScope(await household());
    const guarded = withPolicyOwnership(client, scope);
    const forRule = await guarded.createPolicy(SITE_ID, blockPolicy());
    const rule = await prisma().rule.create({ data: { name: "Rule", kind: RuleKind.category, targetIds: [1] } });
    await prisma().rulePolicy.create({
      data: {
        ruleId: rule.id,
        connectionIdentity: scope.connectionIdentity,
        siteId: SITE_ID,
        unifiPolicyId: forRule.id,
        zoneId: INTERNAL_ZONE,
        desiredFingerprint: "test",
        desiredRevision: 1,
      },
    });
    await guarded.deletePolicy(SITE_ID, forRule.id);

    const justCreated = await guarded.createPolicy(SITE_ID, blockPolicy());
    await prisma().policyOperation.create({
      data: {
        intent: PolicyOperationIntent.create,
        connectionIdentity: scope.connectionIdentity,
        siteId: SITE_ID,
        unifiPolicyId: justCreated.id,
        status: "applied",
      },
    });
    await guarded.deletePolicy(SITE_ID, justCreated.id);
    expect(writes(client).map((call) => call.method)).toEqual(["DELETE", "DELETE"]);
  });

  it("does not accept a pending create, or a record for another console or site", async () => {
    const scope = ownershipScope(await household());
    const guarded = withPolicyOwnership(client, scope);
    const created = await guarded.createPolicy(SITE_ID, blockPolicy());
    const record = { unifiPolicyId: created.id, intent: PolicyOperationIntent.create };
    await prisma().policyOperation.create({
      data: { ...record, connectionIdentity: scope.connectionIdentity, siteId: SITE_ID, status: "pending" },
    });
    await prisma().policyOperation.create({
      data: { ...record, connectionIdentity: "local:https://10.9.9.9/proxy/network/integration:other", siteId: SITE_ID, status: "applied" },
    });
    await expect(guarded.deletePolicy(SITE_ID, created.id)).rejects.toThrow(PolicyOwnershipError);

    // On record for this console and site, but the call names a different site.
    await prisma().policyOperation.updateMany({ where: { status: "pending" }, data: { status: "applied" } });
    await expect(guarded.deletePolicy("another-site", created.id)).rejects.toThrow(PolicyOwnershipError);
    expect(writes(client)).toEqual([]);
  });

  it("passes reads straight through to the client", async () => {
    const guarded = withPolicyOwnership(client, ownershipScope(await household()));
    expect((await guarded.listPolicies(SITE_ID)).map((policy) => policy.id)).toContain(admin.id);
    expect(client.calls.some((call) => call.method === "GET")).toBe(true);
  });
});

describe("clientForHousehold", () => {
  const previous = process.env.FAMILYFI_MODE;

  beforeEach(async () => {
    process.env.FAMILYFI_MODE = "dev";
    resetDevMockClientForTests();
    await resetDatabase();
    await saveUnifiConnection({ apiKey: DEV_MOCK_API_KEY, baseUrl: DEV_MOCK_BASE_URL });
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.FAMILYFI_MODE;
    else process.env.FAMILYFI_MODE = previous;
    resetDevMockClientForTests();
  });

  it("hands every caller the guarded client", async () => {
    const current = await household();
    expect(connectionIdentity(current)).toBeTruthy();
    const client = clientForHousehold(current);
    await expect(client.deletePolicy(current.unifiSiteId!, DEV_MOCK_ADMIN_POLICY_ID)).rejects.toThrow(PolicyOwnershipError);
  });
});

describe("switching to another gateway", () => {
  const previous = process.env.FAMILYFI_MODE;

  beforeEach(async () => {
    process.env.FAMILYFI_MODE = "dev";
    resetDevMockClientForTests();
    await resetDatabase();
    await saveUnifiConnection({ apiKey: DEV_MOCK_API_KEY, baseUrl: DEV_MOCK_BASE_URL });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (previous === undefined) delete process.env.FAMILYFI_MODE;
    else process.env.FAMILYFI_MODE = previous;
    resetDevMockClientForTests();
  });

  it("removes every policy FamilyFi owns on the old one, even one already deleted there or made by a lost create", async () => {
    const current = await household();
    const scope = ownershipScope(current);
    const siteId = current.unifiSiteId!;
    const gateway = getSharedDevMockClient();
    const onRecord = { connectionIdentity: scope.connectionIdentity, siteId, zoneId: INTERNAL_ZONE, desiredFingerprint: "test", desiredRevision: 1 };
    const forRule = await gateway.createPolicy(siteId, blockPolicy("Bedtime"));
    const rule = await prisma().rule.create({ data: { name: "Bedtime", kind: RuleKind.internet } });
    await prisma().rulePolicy.create({ data: { ...onRecord, ruleId: rule.id, unifiPolicyId: forRule.id } });
    const orphan = await gateway.createPolicy(siteId, blockPolicy("Left by a failed delete"));
    await prisma().policyOperation.create({
      data: { intent: PolicyOperationIntent.create, connectionIdentity: scope.connectionIdentity, siteId, unifiPolicyId: orphan.id, status: "applied" },
    });
    // A create there whose answer was lost.
    const lostWrite = blockPolicy("Lost answer");
    const lost = await gateway.createPolicy(siteId, lostWrite);
    await prisma().policyOperation.create({
      data: { intent: PolicyOperationIntent.create, connectionIdentity: scope.connectionIdentity, siteId, payload: lostWrite as Prisma.InputJsonValue, status: "pending" },
    });
    // Someone already removed this quarantine policy on the console.
    const gone = await gateway.createPolicy(siteId, blockPolicy("Quarantine"));
    await prisma().appPolicy.create({
      data: { ...onRecord, unifiPolicyId: gone.id, ownerScope: PolicyOwnerScope.quarantine, ipVersion: "dual" },
    });
    await gateway.deletePolicy(siteId, gone.id);

    await saveUnifiConnection({ apiKey: DEV_MOCK_API_KEY, baseUrl: "https://10.0.0.2/proxy/network/integration" });

    const ids = (await gateway.listPolicies(siteId)).map((policy) => policy.id);
    expect(ids).not.toContain(forRule.id);
    expect(ids).not.toContain(orphan.id);
    expect(ids).not.toContain(lost.id);
    expect(ids).toContain(DEV_MOCK_ADMIN_POLICY_ID);
    expect(await prisma().rulePolicy.count({ where: { connectionIdentity: scope.connectionIdentity } })).toBe(0);
    expect(await prisma().appPolicy.count({ where: { connectionIdentity: scope.connectionIdentity } })).toBe(0);
    expect((await prisma().policyOperation.findFirstOrThrow({ where: { unifiPolicyId: orphan.id } })).status).toBe("removed");
    expect((await household()).unifiBaseUrl).toBe("https://10.0.0.2/proxy/network/integration");
  });

  const NEW_TARGET = "https://10.0.0.2/proxy/network/integration";

  async function recordedRulePolicy() {
    const current = await household();
    const siteId = current.unifiSiteId!;
    const policy = await getSharedDevMockClient().createPolicy(siteId, blockPolicy("Bedtime"));
    const rule = await prisma().rule.create({ data: { name: "Bedtime", kind: RuleKind.internet } });
    await prisma().rulePolicy.create({
      data: { connectionIdentity: connectionIdentity(current), siteId, zoneId: INTERNAL_ZONE, desiredFingerprint: "test", desiredRevision: 1, ruleId: rule.id, unifiPolicyId: policy.id },
    });
    return { policy, identity: connectionIdentity(current), siteId };
  }

  it("leaves everything as it was when the old gateway can't be reached, until asked to forget it", async () => {
    const { policy, identity, siteId } = await recordedRulePolicy();
    const lostWrite = blockPolicy("Lost answer");
    const pending = await prisma().policyOperation.create({
      data: { intent: PolicyOperationIntent.create, connectionIdentity: identity, siteId, payload: lostWrite as Prisma.InputJsonValue, status: "pending" },
    });
    const gateway = getSharedDevMockClient();
    vi.spyOn(gateway, "deletePolicy").mockRejectedValue(new UnifiHttpError(503, "DELETE", "/v1/sites/x/firewall/policies/y", "unreachable"));

    await expect(saveUnifiConnection({ apiKey: DEV_MOCK_API_KEY, baseUrl: NEW_TARGET })).rejects.toBeInstanceOf(PreviousTargetError);
    expect((await household()).unifiBaseUrl).toBe(DEV_MOCK_BASE_URL);
    expect(await prisma().rulePolicy.count({ where: { connectionIdentity: identity } })).toBe(1);

    await saveUnifiConnection({ apiKey: DEV_MOCK_API_KEY, baseUrl: NEW_TARGET, forgetPrevious: true });
    expect((await household()).unifiBaseUrl).toBe(NEW_TARGET);
    expect(await prisma().rulePolicy.count({ where: { connectionIdentity: identity } })).toBe(0);
    expect((await prisma().policyOperation.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("failed");
    // Forgotten, not deleted: it stays on the console FamilyFi left.
    vi.restoreAllMocks();
    expect((await gateway.listPolicies(siteId)).map((item) => item.id)).toContain(policy.id);
  });

  it("answers previous_gateway_unreachable over the API, and switches when told to forget the old gateway", async () => {
    await recordedRulePolicy();
    vi.spyOn(getSharedDevMockClient(), "deletePolicy").mockRejectedValue(new UnifiHttpError(503, "DELETE", "/v1/sites/x/firewall/policies/y", "unreachable"));
    const auth = authFromLogin(
      await login(
        request("/api/v1/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: "admin", password: process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password", client: "browser" }),
        }),
      ),
    );
    const save = (body: object) =>
      putUnifiSettings(request("/api/v1/settings/unifi", { method: "PUT", auth, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

    const refused = await save({ apiKey: DEV_MOCK_API_KEY, baseUrl: NEW_TARGET });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.code).toBe("previous_gateway_unreachable");

    const saved = await save({ apiKey: DEV_MOCK_API_KEY, baseUrl: NEW_TARGET, forgetPrevious: true });
    expect(saved.status).toBe(200);
    expect((await household()).unifiBaseUrl).toBe(NEW_TARGET);
  });

  it("stops before moving the household when its hold on the lock lapses mid-cleanup", async () => {
    const { identity } = await recordedRulePolicy();
    setReconcileLockForTests({ lockMs: 150, renewMs: 400 });
    const gateway = getSharedDevMockClient();
    const remove = gateway.deletePolicy.bind(gateway);
    vi.spyOn(gateway, "deletePolicy").mockImplementation(async (siteId, policyId) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      return remove(siteId, policyId);
    });
    try {
      await expect(saveUnifiConnection({ apiKey: DEV_MOCK_API_KEY, baseUrl: NEW_TARGET, forgetPrevious: true })).rejects.toThrow(/took over/);
    } finally {
      setReconcileLockForTests();
    }
    expect((await household()).unifiBaseUrl).toBe(DEV_MOCK_BASE_URL);
    expect(await prisma().rulePolicy.count({ where: { connectionIdentity: identity } })).toBe(1);
  });

  it("refuses a network choice the new site doesn't have before touching the old one", async () => {
    const { policy, identity, siteId } = await recordedRulePolicy();

    await expect(
      saveUnifiConnection({ apiKey: DEV_MOCK_API_KEY, baseUrl: NEW_TARGET, manageAllNetworks: false, managedNetworkIds: ["no-such-network"] }),
    ).rejects.toThrow(/Unknown UniFi network/);

    expect((await getSharedDevMockClient().listPolicies(siteId)).map((item) => item.id)).toContain(policy.id);
    expect(await prisma().rulePolicy.count({ where: { connectionIdentity: identity } })).toBe(1);
    expect((await household()).unifiBaseUrl).toBe(DEV_MOCK_BASE_URL);
  });

  it("waits for a running sync to let go of the lock before cleaning up the old gateway", async () => {
    const { policy, siteId } = await recordedRulePolicy();
    await prisma().reconciliationLock.upsert({
      where: { id: "global" },
      create: { id: "global", owner: "a running pass", expiresAt: new Date(Date.now() + 60_000) },
      update: { owner: "a running pass", expiresAt: new Date(Date.now() + 60_000) },
    });

    const saving = saveUnifiConnection({ apiKey: DEV_MOCK_API_KEY, baseUrl: NEW_TARGET });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect((await getSharedDevMockClient().listPolicies(siteId)).map((item) => item.id)).toContain(policy.id);
    expect((await household()).unifiBaseUrl).toBe(DEV_MOCK_BASE_URL);

    await prisma().reconciliationLock.update({ where: { id: "global" }, data: { expiresAt: new Date(0) } });
    await saving;
    expect((await getSharedDevMockClient().listPolicies(siteId)).map((item) => item.id)).not.toContain(policy.id);
    expect((await household()).unifiBaseUrl).toBe(NEW_TARGET);
    expect((await prisma().reconciliationLock.findUniqueOrThrow({ where: { id: "global" } })).expiresAt.getTime()).toBe(0);
  });
});
