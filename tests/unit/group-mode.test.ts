import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyD11ModeMapping, modeFromLegacyScheduleEnabled } from "@/server/group-mode";

describe("D11 modeFromLegacyScheduleEnabled", () => {
  it("maps scheduleEnabled true → scheduled and false → always", () => {
    expect(modeFromLegacyScheduleEnabled({ scheduleEnabled: true, protected: false })).toBe("scheduled");
    expect(modeFromLegacyScheduleEnabled({ scheduleEnabled: false, protected: false })).toBe("always");
  });

  it("keeps protected groups always (no policy path)", () => {
    expect(modeFromLegacyScheduleEnabled({ scheduleEnabled: true, protected: true })).toBe("always");
    expect(modeFromLegacyScheduleEnabled({ scheduleEnabled: false, protected: true })).toBe("always");
  });

  it("is idempotent when reapplied to the same legacy fields", () => {
    const legacy = [
      { id: "a", scheduleEnabled: true, protected: false, mode: "always" as const },
      { id: "b", scheduleEnabled: false, protected: false, mode: "scheduled" as const },
      { id: "c", scheduleEnabled: true, protected: true, mode: "scheduled" as const },
      { id: "d", scheduleEnabled: false, protected: true, mode: "always" as const },
    ];
    const first = applyD11ModeMapping(legacy);
    expect(first.map((row) => row.mode)).toEqual(["scheduled", "always", "always", "always"]);
    const second = applyD11ModeMapping(first);
    expect(second.map((row) => ({ id: row.id, mode: row.mode }))).toEqual(
      first.map((row) => ({ id: row.id, mode: row.mode })),
    );
  });

  it("matches the committed D11 migration SQL predicates", () => {
    const sql = readFileSync(
      join(process.cwd(), "prisma/migrations/20260916000000_group_mode/migration.sql"),
      "utf8",
    );
    expect(sql).toContain(`SET "mode" = 'scheduled' WHERE "scheduleEnabled" = true AND "protected" = false`);
    expect(sql).toContain(`SET "mode" = 'always' WHERE "scheduleEnabled" = false OR "protected" = true`);
  });
});
