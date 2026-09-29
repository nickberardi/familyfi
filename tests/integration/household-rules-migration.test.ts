/**
 * The upgrade to household rules keeps every household enforced as it was: a bedtime
 * becomes an internet rule that keeps its UniFi policy, a group that was always blocked
 * becomes paused, and a paused bedtime becomes an allowance. A protected group becomes an
 * ordinary group with no rules, as it was never blocked. Runs the real migration SQL on
 * legacy rows in a scratch schema of the test database.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { env } from "@/server/env";

const MIGRATIONS = path.join(process.cwd(), "prisma/migrations");
const FIRST = "20260928120000_rule_kinds";
const SCHEMA = "household_rules_upgrade";

const client = new pg.Client({ connectionString: env().DATABASE_URL });
const sql = (name: string) => readFileSync(path.join(MIGRATIONS, name, "migration.sql"), "utf8");
const rows = async <T,>(query: string, values: unknown[] = []) => (await client.query(query, values)).rows as T[];

const UNTIL = "2030-01-01T00:00:00.000Z";

beforeAll(async () => {
  await client.connect();
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; SET search_path TO ${SCHEMA}`);
  const names = readdirSync(MIGRATIONS).filter((name) => /^\d/.test(name)).sort();
  for (const name of names.filter((name) => name < FIRST)) await client.query(sql(name));

  await client.query(`
    INSERT INTO "Group" ("id", "kind", "name", "protected", "mode", "scheduleEnabled", "scheduleDays", "scheduleStart", "scheduleEnd", "suspensionActive", "suspensionUntil", "updatedAt") VALUES
      ('bedtime', 'family', 'Betsy', false, 'scheduled', true, '{1,2,3,4,5}', '21:30', '06:45', false, NULL, now()),
      ('bedtime-paused', 'family', 'Sam', false, 'scheduled', true, '{0,1,2,3,4,5,6}', '22:00', '07:00', true, '${UNTIL}', now()),
      ('always', 'things', 'TV', false, 'always', false, '{}', NULL, NULL, false, NULL, now()),
      ('always-paused', 'family', 'Robin', false, 'always', false, '{}', NULL, NULL, true, NULL, now()),
      ('always-paused-timed', 'things', 'Console', false, 'always', false, '{}', NULL, NULL, true, '${UNTIL}', now()),
      ('always-paused-ended', 'things', 'Tablet', false, 'always', false, '{}', NULL, NULL, true, '2020-01-01T00:00:00.000Z', now()),
      ('half-scheduled', 'family', 'Ava', false, 'scheduled', true, '{1}', NULL, NULL, false, NULL, now()),
      ('no-days', 'family', 'Lee', false, 'scheduled', true, '{}', '21:00', '07:00', false, NULL, now()),
      ('protected', 'family', 'Pat', true, 'always', false, '{}', NULL, NULL, false, NULL, now()),
      ('protected-paused', 'things', 'Server', true, 'always', false, '{}', NULL, NULL, true, NULL, now());
    INSERT INTO "AppPolicy" ("id", "connectionIdentity", "siteId", "unifiPolicyId", "ownerScope", "groupId", "zoneId", "ipVersion", "desiredFingerprint", "desiredRevision", "updatedAt") VALUES
      ('ap-bedtime', 'console', 'site', 'pol-bedtime', 'group', 'bedtime', 'zone', 'dual', 'fp', 3, now()),
      ('ap-always', 'console', 'site', 'pol-always', 'group', 'always', 'zone', 'dual', 'fp', 3, now()),
      ('ap-quarantine', 'console', 'site', 'pol-quarantine', 'quarantine', NULL, 'zone', 'dual', 'fp', 3, now());
    INSERT INTO "Rule" ("id", "kind", "scope", "groupId", "networkIds", "targetIds", "enabled", "mode", "scheduleEnabled", "scheduleDays", "scheduleStart", "scheduleEnd", "updatedAt") VALUES
      ('video', 'category', 'group', 'bedtime', '{}', '{4}', true, 'scheduled', true, '{0,1,2,3,4,5,6}', '19:00', '21:00', now()),
      ('apps', 'app', 'network', NULL, '{net}', '{10001}', true, 'always', false, '{}', NULL, NULL, now()),
      ('broken', 'category', 'group', 'bedtime', '{}', '{8}', true, 'scheduled', true, '{1}', NULL, NULL, now()),
      ('no-days', 'category', 'group', 'bedtime', '{}', '{11}', true, 'scheduled', true, '{}', '19:00', '21:00', now()),
      ('pat-video', 'category', 'group', 'protected', '{}', '{4}', true, 'always', false, '{}', NULL, NULL, now());
    INSERT INTO "RulePolicy" ("id", "ruleId", "connectionIdentity", "siteId", "unifiPolicyId", "zoneId", "desiredFingerprint", "desiredRevision", "updatedAt") VALUES
      ('rp-video', 'video', 'console', 'site', 'pol-video', 'zone', 'fp', 3, now());
  `);

  await client.query(sql(FIRST));
  await client.query(sql("20260928120100_household_rules"));
  await client.query(sql("20260929120000_remove_group_protection"));
});

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.end();
});

type RuleRow = { id: string; name: string; kind: string; mode: string; groups: string[] | null; windows: { name: string; days: number[]; start: string; end: string }[] | null };

async function rules(): Promise<RuleRow[]> {
  return rows<RuleRow>(`
    SELECT r."id", r."name", r."kind"::text, r."mode"::text,
      (SELECT array_agg(g."groupId" ORDER BY g."groupId") FROM "RuleGroup" g WHERE g."ruleId" = r."id") AS "groups",
      (SELECT json_agg(json_build_object('name', w."name", 'days', w."days", 'start', w."start", 'end', w."end") ORDER BY w."position")
         FROM "RuleWindow" w WHERE w."ruleId" = r."id") AS "windows"
    FROM "Rule" r ORDER BY r."name"`);
}

describe("household rules migration", () => {
  it("turns each bedtime into an internet rule with one Bedtime window", async () => {
    const internet = (await rules()).filter((rule) => rule.kind === "internet");
    expect(internet.map((rule) => [rule.name, rule.mode, rule.groups, rule.windows])).toEqual([
      ["Bedtime", "scheduled", ["bedtime"], [{ name: "Bedtime", days: [1, 2, 3, 4, 5], start: "21:30", end: "06:45" }]],
      ["Bedtime", "scheduled", ["bedtime-paused"], [{ name: "Bedtime", days: [0, 1, 2, 3, 4, 5, 6], start: "22:00", end: "07:00" }]],
    ]);
  });

  it("moves the bedtime's UniFi policy to the rule, so it is updated in place", async () => {
    const [moved] = await rows<{ ruleName: string; windowName: string; groupId: string }>(`
      SELECT r."name" AS "ruleName", w."name" AS "windowName", g."groupId"
      FROM "RulePolicy" p JOIN "Rule" r ON r."id" = p."ruleId" JOIN "RuleWindow" w ON w."id" = p."windowKey"
      JOIN "RuleGroup" g ON g."ruleId" = r."id" WHERE p."unifiPolicyId" = 'pol-bedtime'`);
    expect(moved).toEqual({ ruleName: "Bedtime", windowName: "Bedtime", groupId: "bedtime" });
    // The group's old record stays without the id, for reconciliation to remove.
    expect(await rows(`SELECT "id", "unifiPolicyId" FROM "AppPolicy" ORDER BY "id"`)).toEqual([
      { id: "ap-always", unifiPolicyId: "pol-always" },
      { id: "ap-bedtime", unifiPolicyId: null },
      { id: "ap-quarantine", unifiPolicyId: "pol-quarantine" },
    ]);
  });

  it("keeps every group blocked that was blocked, and online that was online", async () => {
    const groups = await rows<{ id: string; suspensionActive: boolean; suspensionUntil: Date | null; allowActive: boolean; allowUntil: Date | null }>(
      `SELECT "id", "suspensionActive", "suspensionUntil", "allowActive", "allowUntil" FROM "Group" ORDER BY "id"`,
    );
    const state = Object.fromEntries(groups.map((group) => [group.id, [group.suspensionActive, group.suspensionUntil?.toISOString() ?? null, group.allowActive, group.allowUntil?.toISOString() ?? null]]));
    expect(state).toEqual({
      // Always blocked: now paused until someone resumes it, on its old policy.
      always: [true, null, false, null],
      // Paused with no end while always blocked meant online for good: it stays online.
      "always-paused": [false, null, false, null],
      // A timed pause was online only until its end; that end can't block again, so it blocks now.
      "always-paused-timed": [true, null, false, null],
      // A pause that had already ended left the group blocked: it stays blocked.
      "always-paused-ended": [true, null, false, null],
      bedtime: [false, null, false, null],
      // A paused bedtime gave internet back until then: an allowance until the same time.
      "bedtime-paused": [false, null, true, UNTIL],
      // A schedule with no times blocked all day, like always.
      "half-scheduled": [true, null, false, null],
      // One with times but no days has no window to keep, so it stays blocked like always.
      "no-days": [true, null, false, null],
      protected: [false, null, false, null],
      // Paused before it was protected: the pause never applied, and must not start blocking now.
      "protected-paused": [false, null, false, null],
    });
  });

  it("names existing rules, gives a scheduled rule its window, and keeps its policy on it", async () => {
    const byId = Object.fromEntries((await rules()).map((rule) => [rule.id, rule]));
    expect([byId.video?.name, byId.video?.mode, byId.video?.groups, byId.video?.windows]).toEqual([
      "Video for Betsy",
      "scheduled",
      ["bedtime"],
      [{ name: "", days: [0, 1, 2, 3, 4, 5, 6], start: "19:00", end: "21:00" }],
    ]);
    expect([byId.apps?.name, byId.apps?.mode, byId.apps?.groups]).toEqual(["Apps on networks", "always", null]);
    // A scheduled rule with no times was enforced all day.
    expect([byId.broken?.name, byId.broken?.mode, byId.broken?.windows]).toEqual(["Gaming for Betsy", "always", null]);
    expect([byId["no-days"]?.name, byId["no-days"]?.mode, byId["no-days"]?.windows]).toEqual(["VPN for Betsy", "always", null]);
    const [policy] = await rows<{ windowKey: string; windowId: string }>(`
      SELECT p."windowKey", w."id" AS "windowId" FROM "RulePolicy" p JOIN "RuleWindow" w ON w."ruleId" = p."ruleId" WHERE p."id" = 'rp-video'`);
    expect(policy?.windowKey).toBe(policy?.windowId);
  });

  it("turns a protected group into an ordinary one with no rules, as it was never blocked", async () => {
    const columns = await rows<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'Group'`,
    );
    expect(columns.map((column) => column.column_name)).not.toContain("protected");
    const byId = Object.fromEntries((await rules()).map((rule) => [rule.id, rule]));
    // The rule stays, but no longer covers the group it never applied to.
    expect([byId["pat-video"]?.name, byId["pat-video"]?.groups]).toEqual(["Video for Pat", null]);
  });
});
