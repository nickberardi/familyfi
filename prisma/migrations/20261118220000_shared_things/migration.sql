-- Shared Things (FamilyFi Me): a Things group children can see and ask about, and which child asked.
ALTER TABLE "Group" ADD COLUMN "kidsCanAsk" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Ask" ADD COLUMN "fromGroupId" TEXT;
-- Every ask so far was a child's on its own group.
UPDATE "Ask" SET "fromGroupId" = "groupId";
ALTER TABLE "Ask" ALTER COLUMN "fromGroupId" SET NOT NULL;

CREATE INDEX "Ask_fromGroupId_createdAt_idx" ON "Ask"("fromGroupId", "createdAt");

ALTER TABLE "Ask" ADD CONSTRAINT "Ask_fromGroupId_fkey" FOREIGN KEY ("fromGroupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
