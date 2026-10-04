import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createPrismaClient, prisma } from "@/server/db";
import { resetDatabase } from "../helpers/db";

/**
 * FamilyFi's times are instants. A database whose own time zone is not UTC, as an
 * operator's PostgreSQL or a laptop's may be, must not move what the database fills in,
 * what it compares against its clock, or what anyone reading the tables sees.
 */
const OTHER_ZONE = "Pacific/Kiritimati"; // UTC+14, so any slip is half a day
const CLOSE = 60_000;

describe("a database in another time zone", () => {
  let db: PrismaClient;
  let name: string;

  beforeAll(async () => {
    [{ name }] = await prisma().$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    await prisma().$executeRawUnsafe(`ALTER DATABASE "${name}" SET timezone TO '${OTHER_ZONE}'`);
    db = createPrismaClient(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await db.$disconnect();
    await prisma().$executeRawUnsafe(`ALTER DATABASE "${name}" RESET timezone`);
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it("reads its clock as the real instant", async () => {
    const [{ now }] = await db.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
    expect(Math.abs(now.getTime() - Date.now())).toBeLessThan(CLOSE);
  });

  it("stores a time it fills in as the real instant", async () => {
    await db.$executeRaw`INSERT INTO "LoginAttempt" ("id", "username", "ip", "success") VALUES ('filled', 'nick', '203.0.113.1', true)`;
    const row = await db.loginAttempt.findUniqueOrThrow({ where: { id: "filled" } });
    expect(Math.abs(row.createdAt.getTime() - Date.now())).toBeLessThan(CLOSE);
  });

  it("compares a stored time with its clock as instants", async () => {
    const inAnHour = new Date(Date.now() + 60 * 60_000);
    await db.loginAttempt.create({ data: { id: "later", username: "nick", ip: "203.0.113.1", success: true, createdAt: inAnHour } });
    const later = await db.$queryRaw<{ id: string }[]>`SELECT "id" FROM "LoginAttempt" WHERE "createdAt" > now()`;
    expect(later.map((row) => row.id)).toEqual(["later"]);
    const row = await db.loginAttempt.findUniqueOrThrow({ where: { id: "later" } });
    expect(row.createdAt.toISOString()).toBe(inAnHour.toISOString());
  });

  it("shows another reader the stored instant in its own zone", async () => {
    const instant = new Date("2030-01-01T00:00:00.000Z");
    await db.loginAttempt.create({ data: { id: "read", username: "nick", ip: "203.0.113.1", success: true, createdAt: instant } });
    const [{ text }] = await db.$queryRaw<{ text: string }[]>`
      SELECT ("createdAt" AT TIME ZONE ${OTHER_ZONE})::text AS text FROM "LoginAttempt" WHERE "id" = 'read'`;
    expect(text).toBe("2030-01-01 14:00:00");
  });
});

describe("date columns", () => {
  it("all carry their time zone", async () => {
    const columns = await prisma().$queryRaw<{ column: string; type: string }[]>`
      SELECT table_name || '.' || column_name AS column, data_type AS type FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name <> '_prisma_migrations' AND data_type LIKE 'timestamp%'`;
    expect(columns.length).toBeGreaterThan(0);
    expect(columns.filter((column) => column.type !== "timestamp with time zone")).toEqual([]);
  });
});
