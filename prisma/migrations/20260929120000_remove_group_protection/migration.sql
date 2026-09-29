-- Groups are no longer protected. A protected group was never blocked: it had no pause
-- or allowance, and any rule it was linked to left its devices out. It stays that way:
-- its rule links go, and it becomes an ordinary group with no rules.
DELETE FROM "RuleGroup" WHERE "groupId" IN (SELECT "id" FROM "Group" WHERE "protected");

ALTER TABLE "Group" DROP COLUMN "protected";
