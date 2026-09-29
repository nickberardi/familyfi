-- A group's own pause and allowance become the built-in `internet` rule. Live pauses and
-- allowances are discarded: a paused group is online again, and reconciliation removes its
-- old block policy from the gateway because nothing plans it any more.
ALTER TABLE "Group"
  DROP COLUMN "suspensionActive",
  DROP COLUMN "suspensionUntil",
  DROP COLUMN "suspendedByAccountId",
  DROP COLUMN "suspendedByName",
  DROP COLUMN "allowActive",
  DROP COLUMN "allowUntil",
  DROP COLUMN "allowedByAccountId",
  DROP COLUMN "allowedByName";

ALTER TABLE "Rule"
  ADD COLUMN "systemGroupId" TEXT,
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "blockedByAccountId" TEXT,
  ADD COLUMN "blockedByName" TEXT;

CREATE UNIQUE INDEX "Rule_systemGroupId_key" ON "Rule"("systemGroupId");

ALTER TABLE "Rule" ADD CONSTRAINT "Rule_systemGroupId_fkey" FOREIGN KEY ("systemGroupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
