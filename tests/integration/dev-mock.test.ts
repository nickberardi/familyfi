import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AssignmentState } from "@prisma/client";
import { prisma } from "@/server/db";
import { ensureDevDummyData, DEV_SEED_ADULT_USERNAME } from "@/server/dev-seed";
import { runReconcileOnce, setReconcileClientForTests } from "@/server/reconciliation";
import { saveUnifiConnection } from "@/server/unifi-settings";
import { DEV_MOCK_API_KEY, DEV_MOCK_BASE_URL, resetDevMockClientForTests } from "@/server/unifi/dev-mock";
import { resetDatabase } from "../helpers/db";

describe("dev UniFi mock household", () => {
  const previous = process.env.FAMILYFI_UNIFI_MOCK;

  beforeEach(async () => {
    process.env.FAMILYFI_UNIFI_MOCK = "1";
    resetDevMockClientForTests();
    setReconcileClientForTests(undefined);
    await resetDatabase();
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.FAMILYFI_UNIFI_MOCK;
    else process.env.FAMILYFI_UNIFI_MOCK = previous;
    setReconcileClientForTests(undefined);
    resetDevMockClientForTests();
  });

  it("saves a dummy key without a live console and discovers fixture clients", async () => {
    await saveUnifiConnection({
      apiKey: DEV_MOCK_API_KEY,
      baseUrl: DEV_MOCK_BASE_URL,
    });
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    expect(household.unifiManageAllNetworks).toBe(true);
    expect(household.unifiKeyLastFour).toBe(DEV_MOCK_API_KEY.slice(-4));
    expect(await runReconcileOnce()).toBe(true);
    const devices = await prisma().device.findMany({ orderBy: { mac: "asc" } });
    expect(devices.map((row) => row.mac)).toEqual(["02:00:00:00:00:01", "02:00:00:00:00:02", "02:00:00:00:00:03"]);
  });

  it("seeds groups, an adult login, and assigned devices for UI work", async () => {
    await ensureDevDummyData();
    const groups = await prisma().group.findMany({ orderBy: { name: "asc" } });
    expect(groups.map((group) => group.name)).toEqual(["Betsy", "Living Room", "Pat", "Sam"]);
    const pat = await prisma().account.findUnique({ where: { username: DEV_SEED_ADULT_USERNAME } });
    expect(pat?.isAdmin).toBe(true);
    expect(await runReconcileOnce()).toBe(true);
    const devices = await prisma().device.findMany({ orderBy: { mac: "asc" } });
    expect(devices.every((row) => row.assignment === AssignmentState.assigned)).toBe(true);
    await ensureDevDummyData();
    expect(await prisma().group.count()).toBe(4);
    expect(await prisma().account.count({ where: { username: DEV_SEED_ADULT_USERNAME } })).toBe(1);
  });
});
