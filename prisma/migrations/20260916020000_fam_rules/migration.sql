-- CreateEnum
CREATE TYPE "FamRuleKind" AS ENUM ('category', 'app');

-- CreateEnum
CREATE TYPE "FamRuleMode" AS ENUM ('always', 'scheduled');

-- CreateTable
CREATE TABLE "FamRule" (
    "id" TEXT NOT NULL,
    "kind" "FamRuleKind" NOT NULL,
    "groupId" TEXT NOT NULL,
    "targetIds" INTEGER[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "mode" "FamRuleMode" NOT NULL DEFAULT 'always',
    "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "scheduleDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "scheduleStart" TEXT,
    "scheduleEnd" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FamRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamRulePolicy" (
    "id" TEXT NOT NULL,
    "famRuleId" TEXT NOT NULL,
    "connectionIdentity" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "unifiPolicyId" TEXT,
    "zoneId" TEXT NOT NULL,
    "ipVersion" "IpVersion" NOT NULL DEFAULT 'dual',
    "desiredFingerprint" TEXT NOT NULL,
    "desiredRevision" INTEGER NOT NULL,
    "observedEnabled" BOOLEAN,
    "observedFingerprint" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FamRulePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FamRule_groupId_idx" ON "FamRule"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "FamRulePolicy_unifiPolicyId_key" ON "FamRulePolicy"("unifiPolicyId");

-- CreateIndex
CREATE INDEX "FamRulePolicy_connectionIdentity_siteId_idx" ON "FamRulePolicy"("connectionIdentity", "siteId");

-- CreateIndex
CREATE UNIQUE INDEX "FamRulePolicy_famRuleId_connectionIdentity_siteId_zoneId_key" ON "FamRulePolicy"("famRuleId", "connectionIdentity", "siteId", "zoneId");

-- AddForeignKey
ALTER TABLE "FamRule" ADD CONSTRAINT "FamRule_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamRulePolicy" ADD CONSTRAINT "FamRulePolicy_famRuleId_fkey" FOREIGN KEY ("famRuleId") REFERENCES "FamRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
