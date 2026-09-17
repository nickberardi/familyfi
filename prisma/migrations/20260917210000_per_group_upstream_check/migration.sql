-- A verdict belongs to (category, resolver), not to a category alone. A group pointed
-- at its own DoH endpoint is filtered differently from the rest of the house, so a
-- single household-wide row would report that group's card with someone else's answer.
-- groupId NULL is the household default, which every group without an override reads.
--
-- Existing rows were all measured through the household endpoint, so they become the
-- NULL rows unchanged.

-- DropIndex
DROP INDEX "UpstreamCheck_categoryId_key";

-- AlterTable
ALTER TABLE "UpstreamCheck" ADD COLUMN     "groupId" TEXT;

-- CreateIndex
CREATE INDEX "UpstreamCheck_groupId_idx" ON "UpstreamCheck"("groupId");

-- CreateIndex
-- NULLS NOT DISTINCT because the household row is keyed by a NULL groupId, and Postgres
-- otherwise treats every NULL as unique — which would let a concurrent sweep and a
-- "Check now" each insert their own household row for the same category. Prisma's
-- @@unique cannot express this, so the index is written by hand; introspection ignores
-- the clause, so this does not drift.
CREATE UNIQUE INDEX "UpstreamCheck_categoryId_groupId_key"
  ON "UpstreamCheck"("categoryId", "groupId") NULLS NOT DISTINCT;

-- AddForeignKey
ALTER TABLE "UpstreamCheck" ADD CONSTRAINT "UpstreamCheck_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
