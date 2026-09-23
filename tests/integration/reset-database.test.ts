import { beforeEach, describe, expect, it } from "vitest";
import { ConnectionTransport } from "@prisma/client";
import { prisma } from "@/server/db";
import { createFamilyGroup, resetDatabase, seedDevice } from "../helpers/db";

/** Row count of every table in the schema, found the same way the reset finds them. */
async function rowCounts(): Promise<Record<string, number>> {
  const db = prisma();
  const tables = await db.$queryRaw<{ name: string }[]>`
    SELECT tablename AS name FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
  const counts: Record<string, number> = {};
  for (const { name } of tables) {
    const [{ count }] = await db.$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*) AS count FROM "${name}"`);
    counts[name] = Number(count);
  }
  return counts;
}

describe("resetDatabase", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("empties every table, not just the ones someone remembered to list", async () => {
    // Paired phones are what a hand-kept list missed before: nothing cascades to them.
    const group = await createFamilyGroup();
    await seedDevice({ mac: "02:00:00:00:00:01", groupId: group.id });
    const endpoint = await prisma().connectionEndpoint.create({
      data: { url: "https://familyfi.lan:7443", transport: ConnectionTransport.lan },
    });
    const phone = await prisma().pairedDevice.create({ data: { displayName: "Phone", credentialHash: "reset-test" } });
    await prisma().pairing.create({
      data: {
        endpointId: endpoint.id,
        tokenHash: "reset-test",
        displayName: "Phone",
        createdByAccountId: "reset-test",
        expiresAt: new Date(Date.now() + 60_000),
        claimedDeviceId: phone.id,
      },
    });
    const before = await rowCounts();
    for (const table of ["Group", "Device", "ConnectionEndpoint", "PairedDevice", "Pairing"]) {
      expect(before[table], `${table} before the reset`).toBeGreaterThan(0);
    }

    await resetDatabase();

    // Only the household and the recovery account come back, seeded by the reset itself.
    const after = await rowCounts();
    const leftovers = Object.fromEntries(Object.entries(after).filter(([, count]) => count > 0));
    expect(leftovers).toEqual({ Household: 1, Account: 1 });
  });
});
