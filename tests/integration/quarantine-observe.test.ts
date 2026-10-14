import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PolicyOwnerScope } from "@prisma/client";
import { prisma } from "@/server/db";
import { recordQuarantineObservation, storedQuarantineBlocking } from "@/server/quarantine";
import { runReconcileOnce } from "@/server/reconciliation";
import { saveUnifiConnection } from "@/server/unifi-settings";
import { DEV_MOCK_API_KEY, DEV_MOCK_BASE_URL, getSharedDevMockClient, resetDevMockClientForTests } from "@/server/unifi/dev-mock";
import { resetDatabase } from "../helpers/db";

const household = () => prisma().household.findUniqueOrThrow({ where: { id: "default" } });

/**
 * Whether quarantine is really blocking, as Settings shows it. Each reconcile pass records
 * what the gateway holds; when nothing could be seen it must say so (null), never report
 * quarantine as off. Settings itself never asks the console.
 */
describe("storedQuarantineBlocking", () => {
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
    expect(await storedQuarantineBlocking()).toEqual({ observedEnabled: false, policyCount: 0 });
  });

  it("is off in a new household, so connecting the gateway blocks no unassigned device", async () => {
    expect((await household()).quarantineEnforced).toBe(false);
    await saveUnifiConnection({ apiKey: DEV_MOCK_API_KEY, baseUrl: DEV_MOCK_BASE_URL });
    await runReconcileOnce();
    expect(await prisma().device.count({ where: { assignment: "quarantined" } })).toBeGreaterThan(0);
    const rows = await prisma().appPolicy.findMany({ where: { ownerScope: PolicyOwnerScope.quarantine } });
    expect(await storedQuarantineBlocking()).toEqual({ observedEnabled: false, policyCount: rows.length });
  });

  it("follows the gateway as reconcile sees it, and the household's quarantine switch", async () => {
    await prisma().household.update({ where: { id: "default" }, data: { quarantineEnforced: true } });
    await saveUnifiConnection({ apiKey: DEV_MOCK_API_KEY, baseUrl: DEV_MOCK_BASE_URL });
    await runReconcileOnce();
    const rows = await prisma().appPolicy.findMany({ where: { ownerScope: PolicyOwnerScope.quarantine } });
    expect(rows.length).toBeGreaterThan(0);
    expect(await storedQuarantineBlocking()).toEqual({ observedEnabled: true, policyCount: rows.length });

    await prisma().household.update({ where: { id: "default" }, data: { quarantineEnforced: false } });
    await runReconcileOnce();
    expect(await storedQuarantineBlocking()).toEqual({ observedEnabled: false, policyCount: rows.length });
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
    await recordQuarantineObservation(client.state.policies);
    const result = await storedQuarantineBlocking();
    expect(result.observedEnabled).toBeNull();
  });

  it("is recorded by each reconcile pass, and read without asking the console", async () => {
    await prisma().household.update({ where: { id: "default" }, data: { quarantineEnforced: true } });
    await saveUnifiConnection({ apiKey: DEV_MOCK_API_KEY, baseUrl: DEV_MOCK_BASE_URL });
    await runReconcileOnce();
    // A pass with nothing to write still records what the gateway holds.
    await prisma().appPolicy.updateMany({ where: { ownerScope: PolicyOwnerScope.quarantine }, data: { observedEnabled: null } });
    await runReconcileOnce();
    const client = getSharedDevMockClient();
    const before = client.calls.length;
    expect(await storedQuarantineBlocking()).toMatchObject({ observedEnabled: true });
    expect(client.calls.length).toBe(before);
  });

  it("keeps what it last saw when it cannot reach the gateway, and is unknown when it saw nothing", async () => {
    await saveUnifiConnection({ apiKey: DEV_MOCK_API_KEY, baseUrl: DEV_MOCK_BASE_URL });
    await runReconcileOnce();
    const count = await prisma().appPolicy.count({ where: { ownerScope: PolicyOwnerScope.quarantine } });
    // Outside the mock the saved key is decrypted, and this one cannot be: the read fails.
    delete process.env.FAMILYFI_MODE;
    await prisma().household.update({ where: { id: "default" }, data: { unifiKeyCiphertext: Buffer.from("not a key") } });

    await prisma().appPolicy.updateMany({ where: { ownerScope: PolicyOwnerScope.quarantine }, data: { observedEnabled: true } });
    expect(await storedQuarantineBlocking()).toEqual({ observedEnabled: true, policyCount: count });

    await prisma().appPolicy.updateMany({ where: { ownerScope: PolicyOwnerScope.quarantine }, data: { observedEnabled: null } });
    expect((await storedQuarantineBlocking()).observedEnabled).toBeNull();
  });

  it("uses what it last saw when no UniFi key is saved", async () => {
    await prisma().household.update({ where: { id: "default" }, data: { quarantineEnforced: true } });
    await saveUnifiConnection({ apiKey: DEV_MOCK_API_KEY, baseUrl: DEV_MOCK_BASE_URL });
    await runReconcileOnce();
    await prisma().household.update({ where: { id: "default" }, data: { unifiKeyLastFour: null } });
    expect((await storedQuarantineBlocking()).observedEnabled).toBe(true);
  });
});
