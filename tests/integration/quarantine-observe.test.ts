import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PolicyOwnerScope } from "@prisma/client";
import { prisma } from "@/server/db";
import { observeQuarantineBlocking } from "@/server/quarantine";
import { runReconcileOnce } from "@/server/reconciliation";
import { saveUnifiConnection } from "@/server/unifi-settings";
import { DEV_MOCK_API_KEY, DEV_MOCK_BASE_URL, getSharedDevMockClient, resetDevMockClientForTests } from "@/server/unifi/dev-mock";
import { resetDatabase } from "../helpers/db";

const household = () => prisma().household.findUniqueOrThrow({ where: { id: "default" } });

/**
 * Whether quarantine is really blocking, as Settings shows it. It reads the gateway when it
 * can; when it cannot look it must say so (null), never report quarantine as off.
 */
describe("observeQuarantineBlocking", () => {
  const previous = process.env.FAMILYFI_MODE;

  beforeEach(async () => {
    process.env.FAMILYFI_MODE = "dev";
    resetDevMockClientForTests();
    await resetDatabase();
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.FAMILYFI_MODE;
    else process.env.FAMILYFI_MODE = previous;
    resetDevMockClientForTests();
  });

  it("is not blocking when there are no quarantine policies", async () => {
    expect(await observeQuarantineBlocking(await household())).toEqual({ observedEnabled: false, policyCount: 0 });
  });

  it("is off in a new household, so connecting the gateway blocks no unassigned device", async () => {
    expect((await household()).quarantineEnforced).toBe(false);
    await saveUnifiConnection({ apiKey: DEV_MOCK_API_KEY, baseUrl: DEV_MOCK_BASE_URL });
    await runReconcileOnce();
    expect(await prisma().device.count({ where: { assignment: "quarantined" } })).toBeGreaterThan(0);
    const rows = await prisma().appPolicy.findMany({ where: { ownerScope: PolicyOwnerScope.quarantine } });
    expect(await observeQuarantineBlocking(await household())).toEqual({ observedEnabled: false, policyCount: rows.length });
  });

  it("reads the gateway, and follows the household's quarantine switch", async () => {
    await prisma().household.update({ where: { id: "default" }, data: { quarantineEnforced: true } });
    await saveUnifiConnection({ apiKey: DEV_MOCK_API_KEY, baseUrl: DEV_MOCK_BASE_URL });
    await runReconcileOnce();
    const rows = await prisma().appPolicy.findMany({ where: { ownerScope: PolicyOwnerScope.quarantine } });
    expect(rows.length).toBeGreaterThan(0);
    expect(await observeQuarantineBlocking(await household())).toEqual({ observedEnabled: true, policyCount: rows.length });

    await prisma().household.update({ where: { id: "default" }, data: { quarantineEnforced: false } });
    await runReconcileOnce();
    expect(await observeQuarantineBlocking(await household())).toEqual({ observedEnabled: false, policyCount: rows.length });
    const observed = await prisma().appPolicy.findMany({ where: { ownerScope: PolicyOwnerScope.quarantine } });
    expect(observed.every((row) => row.observedEnabled === false)).toBe(true);
  });

  it("says it does not know, rather than off, when the gateway has none of its policies", async () => {
    await saveUnifiConnection({ apiKey: DEV_MOCK_API_KEY, baseUrl: DEV_MOCK_BASE_URL });
    await runReconcileOnce();
    const recorded = new Set(
      (await prisma().appPolicy.findMany({ where: { ownerScope: PolicyOwnerScope.quarantine } })).map((row) => row.unifiPolicyId),
    );
    const client = getSharedDevMockClient();
    client.state.policies = client.state.policies.filter((policy) => !recorded.has(policy.id));
    const result = await observeQuarantineBlocking(await household());
    expect(result.observedEnabled).toBeNull();
  });

  it("falls back to what it last saw when it cannot reach the gateway, and to unknown when it saw nothing", async () => {
    await saveUnifiConnection({ apiKey: DEV_MOCK_API_KEY, baseUrl: DEV_MOCK_BASE_URL });
    await runReconcileOnce();
    const count = await prisma().appPolicy.count({ where: { ownerScope: PolicyOwnerScope.quarantine } });
    // Outside the mock the saved key is decrypted, and this one cannot be: the read fails.
    delete process.env.FAMILYFI_MODE;
    await prisma().household.update({ where: { id: "default" }, data: { unifiKeyCiphertext: Buffer.from("not a key") } });

    await prisma().appPolicy.updateMany({ where: { ownerScope: PolicyOwnerScope.quarantine }, data: { observedEnabled: true } });
    expect(await observeQuarantineBlocking(await household())).toEqual({ observedEnabled: true, policyCount: count });

    await prisma().appPolicy.updateMany({ where: { ownerScope: PolicyOwnerScope.quarantine }, data: { observedEnabled: null } });
    expect((await observeQuarantineBlocking(await household())).observedEnabled).toBeNull();
  });

  it("uses what it last saw when no UniFi key is saved", async () => {
    await prisma().household.update({ where: { id: "default" }, data: { quarantineEnforced: true } });
    await saveUnifiConnection({ apiKey: DEV_MOCK_API_KEY, baseUrl: DEV_MOCK_BASE_URL });
    await runReconcileOnce();
    await prisma().household.update({ where: { id: "default" }, data: { unifiKeyLastFour: null } });
    expect((await observeQuarantineBlocking(await household())).observedEnabled).toBe(true);
  });
});
