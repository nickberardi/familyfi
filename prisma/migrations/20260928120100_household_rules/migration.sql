-- Rules become household objects: a name, several groups and several named windows,
-- each window its own UniFi policy. A group's internet schedule becomes an optional
-- internet rule, and pause changes meaning: it now blocks all internet until resumed.
-- Enforcement is preserved: every group blocked before the upgrade is blocked after it.

-- New columns and tables ------------------------------------------------------------

ALTER TABLE "Group"
ADD COLUMN "allowActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "allowUntil" TIMESTAMP(3),
ADD COLUMN "allowedByAccountId" TEXT,
ADD COLUMN "allowedByName" TEXT,
ADD COLUMN "suspendedByAccountId" TEXT,
ADD COLUMN "suspendedByName" TEXT;

ALTER TABLE "Rule"
ADD COLUMN "domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "name" TEXT,
ADD COLUMN "useGeneratedName" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "targetIds" SET DEFAULT ARRAY[]::INTEGER[];

ALTER TABLE "RulePolicy" ADD COLUMN "windowKey" TEXT NOT NULL DEFAULT 'always';

CREATE TABLE "RuleGroup" (
    "ruleId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "RuleGroup_pkey" PRIMARY KEY ("ruleId","groupId")
);

CREATE TABLE "RuleWindow" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "days" INTEGER[],
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,

    CONSTRAINT "RuleWindow_pkey" PRIMARY KEY ("id")
);

-- Existing category and app rules ---------------------------------------------------

-- Name each rule after what it blocks and who it covers.
UPDATE "Rule" AS r SET "name" = left(
  (CASE
    WHEN r."kind" = 'category' AND r."targetIds" = ARRAY[4] THEN 'Video'
    WHEN r."kind" = 'category' AND r."targetIds" = ARRAY[24] THEN 'Social'
    WHEN r."kind" = 'category' AND r."targetIds" = ARRAY[8] THEN 'Gaming'
    WHEN r."kind" = 'category' AND r."targetIds" = ARRAY[11] THEN 'VPN'
    WHEN r."kind" = 'category' AND r."targetIds" = ARRAY[0] THEN 'Messaging'
    WHEN r."kind" = 'category' THEN 'Categories'
    ELSE 'Apps'
  END)
  || COALESCE(
    ' for ' || NULLIF(btrim((SELECT g."name" FROM "Group" AS g WHERE g."id" = r."groupId")), ''),
    CASE WHEN r."scope" = 'network' THEN ' on networks' ELSE '' END
  ),
  60);

INSERT INTO "RuleGroup" ("ruleId", "groupId")
SELECT "id", "groupId" FROM "Rule" WHERE "groupId" IS NOT NULL;

-- A scheduled rule keeps its one window, and its policies stay with it.
INSERT INTO "RuleWindow" ("id", "ruleId", "position", "name", "days", "start", "end")
SELECT 'rw_' || replace(gen_random_uuid()::text, '-', ''), "id", 0, '', "scheduleDays", "scheduleStart", "scheduleEnd"
FROM "Rule"
WHERE "mode" = 'scheduled' AND "scheduleEnabled" AND "scheduleStart" IS NOT NULL AND "scheduleEnd" IS NOT NULL;

UPDATE "RulePolicy" AS p SET "windowKey" = w."id"
FROM "RuleWindow" AS w WHERE w."ruleId" = p."ruleId";

-- A scheduled rule without a usable window was enforced all day; say so.
UPDATE "Rule" SET "mode" = 'always'
WHERE "mode" = 'scheduled' AND "id" NOT IN (SELECT "ruleId" FROM "RuleWindow");

-- Group internet schedules ----------------------------------------------------------

CREATE TEMP TABLE "_bedtime" AS
SELECT
  g."id" AS "groupId",
  'rule_' || replace(gen_random_uuid()::text, '-', '') AS "ruleId",
  'rw_' || replace(gen_random_uuid()::text, '-', '') AS "windowId",
  g."scheduleDays" AS "days",
  g."scheduleStart" AS "start",
  g."scheduleEnd" AS "end"
FROM "Group" AS g
WHERE NOT g."protected" AND g."mode" = 'scheduled' AND g."scheduleEnabled"
  AND g."scheduleStart" IS NOT NULL AND g."scheduleEnd" IS NOT NULL;

-- A group's bedtime becomes an internet rule with one window called Bedtime.
INSERT INTO "Rule" ("id", "name", "kind", "scope", "networkIds", "targetIds", "domains", "enabled", "mode", "createdAt", "updatedAt")
SELECT "ruleId", 'Bedtime', 'internet', 'group', ARRAY[]::TEXT[], ARRAY[]::INTEGER[], ARRAY[]::TEXT[], true, 'scheduled', now(), now()
FROM "_bedtime";

INSERT INTO "RuleGroup" ("ruleId", "groupId") SELECT "ruleId", "groupId" FROM "_bedtime";

INSERT INTO "RuleWindow" ("id", "ruleId", "position", "name", "days", "start", "end")
SELECT "windowId", "ruleId", 0, 'Bedtime', "days", "start", "end" FROM "_bedtime";

-- The UniFi policy that enforced the bedtime now belongs to the rule, so it is updated
-- in place on the next pass instead of being deleted and created again. The group's old
-- record keeps its row without the id, and reconciliation removes it.
INSERT INTO "RulePolicy" (
  "id", "ruleId", "windowKey", "connectionIdentity", "siteId", "unifiPolicyId", "zoneId", "ipVersion",
  "desiredFingerprint", "desiredRevision", "observedEnabled", "observedFingerprint", "lastError", "createdAt", "updatedAt"
)
SELECT
  'rp_' || replace(gen_random_uuid()::text, '-', ''), b."ruleId", b."windowId", a."connectionIdentity", a."siteId",
  a."unifiPolicyId", a."zoneId", a."ipVersion", a."desiredFingerprint", a."desiredRevision", a."observedEnabled",
  a."observedFingerprint", a."lastError", a."createdAt", now()
FROM "AppPolicy" AS a JOIN "_bedtime" AS b ON b."groupId" = a."groupId"
WHERE a."ownerScope" = 'group' AND a."unifiPolicyId" IS NOT NULL;

UPDATE "AppPolicy" SET "unifiPolicyId" = NULL
WHERE "ownerScope" = 'group' AND "groupId" IN (SELECT "groupId" FROM "_bedtime");

-- Pausing a bedtime used to give internet back. That is now an allowance.
UPDATE "Group" SET
  "allowActive" = true,
  "allowUntil" = "suspensionUntil",
  "suspensionActive" = false,
  "suspensionUntil" = NULL
WHERE "id" IN (SELECT "groupId" FROM "_bedtime") AND "suspensionActive";

-- Any other unprotected group was blocked at all times unless paused. Blocking all
-- internet is what a pause means now, so it stays blocked until someone resumes it.
-- One paused with no end was online for good, and stays online. A timed pause was
-- online only until its end (or had already ended); nothing can block again at that
-- time now, so it is blocked straight away rather than left online for good.
UPDATE "Group" SET
  "suspensionActive" = NOT ("suspensionActive" AND "suspensionUntil" IS NULL),
  "suspensionUntil" = NULL
WHERE NOT "protected" AND "id" NOT IN (SELECT "groupId" FROM "_bedtime");

DROP TABLE "_bedtime";

-- Old columns -----------------------------------------------------------------------

ALTER TABLE "Rule" DROP CONSTRAINT "Rule_groupId_fkey";
DROP INDEX "Rule_groupId_idx";
DROP INDEX "RulePolicy_ruleId_connectionIdentity_siteId_zoneId_key";

ALTER TABLE "Group" DROP COLUMN "mode",
DROP COLUMN "scheduleDays",
DROP COLUMN "scheduleEnabled",
DROP COLUMN "scheduleEnd",
DROP COLUMN "scheduleStart";

ALTER TABLE "Rule" DROP COLUMN "groupId",
DROP COLUMN "scheduleDays",
DROP COLUMN "scheduleEnabled",
DROP COLUMN "scheduleEnd",
DROP COLUMN "scheduleStart",
ALTER COLUMN "name" SET NOT NULL;

DROP TYPE "GroupMode";

CREATE INDEX "RuleGroup_groupId_idx" ON "RuleGroup"("groupId");
CREATE INDEX "RuleWindow_ruleId_idx" ON "RuleWindow"("ruleId");
CREATE UNIQUE INDEX "RulePolicy_ruleId_windowKey_connectionIdentity_siteId_zoneI_key" ON "RulePolicy"("ruleId", "windowKey", "connectionIdentity", "siteId", "zoneId");

ALTER TABLE "RuleGroup" ADD CONSTRAINT "RuleGroup_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RuleGroup" ADD CONSTRAINT "RuleGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RuleWindow" ADD CONSTRAINT "RuleWindow_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
