-- CreateEnum
CREATE TYPE "FamRuleScope" AS ENUM ('group', 'network');

-- AlterTable
ALTER TABLE "FamRule" ADD COLUMN "scope" "FamRuleScope" NOT NULL DEFAULT 'group';
ALTER TABLE "FamRule" ADD COLUMN "networkIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Make groupId optional for network-scoped rules
ALTER TABLE "FamRule" DROP CONSTRAINT "FamRule_groupId_fkey";
ALTER TABLE "FamRule" ALTER COLUMN "groupId" DROP NOT NULL;
ALTER TABLE "FamRule" ADD CONSTRAINT "FamRule_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "FamRule_scope_idx" ON "FamRule"("scope");
