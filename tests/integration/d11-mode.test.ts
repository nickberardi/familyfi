import { execFileSync } from "node:child_process";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { FamilyRole, GroupKind } from "@prisma/client";
import { prisma } from "@/server/db";
import { modeFromLegacyScheduleEnabled } from "@/server/group-mode";
import { resetDatabase } from "../helpers/db";

const ROOT = path.resolve(__dirname, "../..");

const D11_SQL = [
  `UPDATE "Group" SET "mode" = 'scheduled' WHERE "scheduleEnabled" = true AND "protected" = false`,
  `UPDATE "Group" SET "mode" = 'always' WHERE "scheduleEnabled" = false OR "protected" = true`,
];

async function applyD11Sql() {
  const db = prisma();
  for (const statement of D11_SQL) {
    await db.$executeRawUnsafe(statement);
  }
}

describe("D11 group mode migration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("maps scheduleEnabled to mode and stays stable on a second apply (boot/migrate idempotent)", async () => {
    const db = prisma();
    const scheduled = await db.group.create({
      data: {
        kind: GroupKind.family,
        name: "Legacy Scheduled",
        familyRole: FamilyRole.child,
        mode: "always",
        scheduleEnabled: true,
        scheduleDays: [1, 2, 3, 4, 5],
        scheduleStart: "21:00",
        scheduleEnd: "07:00",
        protected: false,
      },
    });
    const always = await db.group.create({
      data: {
        kind: GroupKind.family,
        name: "Legacy Always",
        familyRole: FamilyRole.teen,
        mode: "scheduled",
        scheduleEnabled: false,
        protected: false,
      },
    });
    const protectedGroup = await db.group.create({
      data: {
        kind: GroupKind.family,
        name: "Legacy Protected",
        familyRole: FamilyRole.adult,
        mode: "scheduled",
        scheduleEnabled: true,
        protected: true,
      },
    });

    await applyD11Sql();

    const afterFirst = await db.group.findMany({
      where: { id: { in: [scheduled.id, always.id, protectedGroup.id] } },
      orderBy: { name: "asc" },
    });
    const byId = Object.fromEntries(afterFirst.map((row) => [row.id, row]));
    expect(byId[scheduled.id]?.mode).toBe("scheduled");
    expect(byId[always.id]?.mode).toBe("always");
    expect(byId[protectedGroup.id]?.mode).toBe("always");
    for (const row of afterFirst) {
      expect(row.mode).toBe(modeFromLegacyScheduleEnabled(row));
    }

    await applyD11Sql();
    const afterSecond = await db.group.findMany({
      where: { id: { in: [scheduled.id, always.id, protectedGroup.id] } },
      orderBy: { name: "asc" },
    });
    expect(afterSecond.map((row) => ({ id: row.id, mode: row.mode }))).toEqual(
      afterFirst.map((row) => ({ id: row.id, mode: row.mode })),
    );

    execFileSync(path.join(ROOT, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
      cwd: ROOT,
      env: process.env,
      stdio: "pipe",
    });
    const afterMigrate = await db.group.findMany({
      where: { id: { in: [scheduled.id, always.id, protectedGroup.id] } },
      orderBy: { name: "asc" },
    });
    expect(afterMigrate.map((row) => ({ id: row.id, mode: row.mode }))).toEqual(
      afterFirst.map((row) => ({ id: row.id, mode: row.mode })),
    );
  });
});
