-- Groups are no longer protected. A protected group was never blocked: any rule it was
-- linked to left its devices out, and a pause or allowance it carried (set before it was
-- protected) was ignored. It stays that way: its rule links, pause and allowance go, and
-- it becomes an ordinary group with no rules.
DELETE FROM "RuleGroup" WHERE "groupId" IN (SELECT "id" FROM "Group" WHERE "protected");

UPDATE "Group" SET
  "suspensionActive" = false,
  "suspensionUntil" = NULL,
  "suspendedByAccountId" = NULL,
  "suspendedByName" = NULL,
  "allowActive" = false,
  "allowUntil" = NULL,
  "allowedByAccountId" = NULL,
  "allowedByName" = NULL
WHERE "protected";

ALTER TABLE "Group" DROP COLUMN "protected";
