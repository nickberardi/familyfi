/**
 * A group's own pause and allowance become the built-in `internet` rule, so the columns
 * that held them go. A group paused or allowed at upgrade is online again: its live state
 * is discarded, and the group and its rules survive. Runs the real migration SQL on rows
 * in a scratch schema of the test database.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { env } from "@/server/env";

const MIGRATIONS = path.join(process.cwd(), "prisma/migrations");
const THIS = "20260930140000_group_internet_rule";
const SCHEMA = "group_internet_rule_upgrade";

const client = new pg.Client({ connectionString: env().DATABASE_URL });
const sql = (name: string) => readFileSync(path.join(MIGRATIONS, name, "migration.sql"), "utf8");
const columns = async (table: string) =>
  (
    await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = $1`, [table])
  ).rows.map((row) => row.column_name as string);

beforeAll(async () => {
  await client.connect();
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; SET search_path TO ${SCHEMA}`);
  const names = readdirSync(MIGRATIONS).filter((name) => /^\d/.test(name)).sort();
  for (const name of names.filter((name) => name < THIS)) await client.query(sql(name));
  await client.query(`
    INSERT INTO "Group" ("id", "kind", "name", "suspensionActive", "suspensionUntil", "suspendedByName", "allowActive", "allowUntil", "allowedByName", "updatedAt") VALUES
      ('paused', 'family', 'Robin', true, '2030-01-01T00:00:00.000Z', 'Pat', false, NULL, NULL, now()),
      ('allowed', 'family', 'Sam', false, NULL, NULL, true, NULL, 'Pat', now());
    INSERT INTO "Rule" ("id", "name", "kind", "updatedAt") VALUES ('video', 'Video', 'category', now());
    INSERT INTO "RuleGroup" ("ruleId", "groupId") VALUES ('video', 'paused');
  `);
  await client.query(sql(THIS));
});

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.end();
});

describe("group internet rule migration", () => {
  it("drops the group's own pause and allowance columns and keeps the groups", async () => {
    const names = await columns("Group");
    for (const gone of ["suspensionActive", "suspensionUntil", "suspendedByAccountId", "suspendedByName", "allowActive", "allowUntil", "allowedByAccountId", "allowedByName"]) {
      expect(names).not.toContain(gone);
    }
    const groups = (await client.query(`SELECT "id" FROM "Group" ORDER BY "id"`)).rows.map((row) => row.id);
    expect(groups).toEqual(["allowed", "paused"]);
  });

  it("adds the built-in rule's columns and leaves existing rules and their links alone", async () => {
    expect(await columns("Rule")).toEqual(expect.arrayContaining(["systemGroupId", "expiresAt", "blockedByAccountId", "blockedByName"]));
    const rule = (await client.query(`SELECT "id", "systemGroupId", "expiresAt" FROM "Rule"`)).rows;
    expect(rule).toEqual([{ id: "video", systemGroupId: null, expiresAt: null }]);
    const links = (await client.query(`SELECT "ruleId", "groupId" FROM "RuleGroup"`)).rows;
    expect(links).toEqual([{ ruleId: "video", groupId: "paused" }]);
  });

  it("allows one built-in rule per group, and removes it with the group", async () => {
    await client.query(`INSERT INTO "Rule" ("id", "name", "kind", "systemGroupId", "updatedAt") VALUES ('block', 'Robin pause', 'internet', 'paused', now())`);
    await expect(
      client.query(`INSERT INTO "Rule" ("id", "name", "kind", "systemGroupId", "updatedAt") VALUES ('block2', 'Again', 'internet', 'paused', now())`),
    ).rejects.toThrow(/Rule_systemGroupId_key/);
    await client.query(`DELETE FROM "Group" WHERE "id" = 'paused'`);
    expect((await client.query(`SELECT 1 FROM "Rule" WHERE "id" = 'block'`)).rowCount).toBe(0);
  });
});
