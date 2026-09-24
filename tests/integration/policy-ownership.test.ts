import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PolicyOperationIntent, PolicyOwnerScope, RuleKind, type Household } from "@prisma/client";
import { prisma } from "@/server/db";
import { saveUnifiConnection } from "@/server/unifi-settings";
import { clientForHousehold, connectionIdentity, ownershipScope } from "@/server/unifi/connection";
import {
  DEV_MOCK_ADMIN_POLICY_ID,
  DEV_MOCK_API_KEY,
  DEV_MOCK_BASE_URL,
  DEV_MOCK_ROGUE_POLICY_ID,
  resetDevMockClientForTests,
} from "@/server/unifi/dev-mock";
import { PolicyOwnershipError } from "@/server/unifi/errors";
import { internetBlockPolicy } from "@/server/unifi/payloads";
import { withPolicyOwnership } from "@/server/unifi/policy-ownership";
import type { FirewallPolicy } from "@/server/unifi/types";
import { INTERNAL_ZONE, SITE_ID, configureConnectedHousehold, resetDatabase } from "../helpers/db";
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
    const rule = await prisma().rule.create({ data: { kind: RuleKind.category, targetIds: [1] } });
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
    const rule = await prisma().rule.create({ data: { kind: RuleKind.category, targetIds: [1] } });
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
  const previous = process.env.UNIFI_MOCK;

  beforeEach(async () => {
    process.env.UNIFI_MOCK = "1";
    resetDevMockClientForTests();
    await resetDatabase();
    await saveUnifiConnection({ apiKey: DEV_MOCK_API_KEY, baseUrl: DEV_MOCK_BASE_URL });
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.UNIFI_MOCK;
    else process.env.UNIFI_MOCK = previous;
    resetDevMockClientForTests();
  });

  it("hands every caller the guarded client", async () => {
    const current = await household();
    expect(connectionIdentity(current)).toBeTruthy();
    const client = clientForHousehold(current);
    await expect(client.deletePolicy(current.unifiSiteId!, DEV_MOCK_ADMIN_POLICY_ID)).rejects.toThrow(PolicyOwnershipError);
  });
});
