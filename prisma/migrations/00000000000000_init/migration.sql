-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "GroupKind" AS ENUM ('family', 'things');

-- CreateEnum
CREATE TYPE "FamilyRole" AS ENUM ('child', 'teen', 'adult');

-- CreateEnum
CREATE TYPE "AssignmentState" AS ENUM ('assigned', 'quarantined');

-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('recovery', 'personal');

-- CreateEnum
CREATE TYPE "SessionKind" AS ENUM ('cookie', 'bearer');

-- CreateEnum
CREATE TYPE "PolicyOwnerScope" AS ENUM ('group', 'quarantine');

-- CreateEnum
CREATE TYPE "IpVersion" AS ENUM ('ipv4', 'ipv6', 'dual');

-- CreateEnum
CREATE TYPE "PolicyOperationIntent" AS ENUM ('create', 'update', 'delete');

-- CreateEnum
CREATE TYPE "ChangeStatus" AS ENUM ('pending', 'applied', 'partial', 'failed', 'superseded');

-- CreateTable
CREATE TABLE "Household" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "unifiMode" TEXT,
    "unifiBaseUrl" TEXT,
    "unifiConsoleId" TEXT,
    "unifiSiteId" TEXT,
    "unifiKeyCiphertext" BYTEA,
    "unifiKeyIv" BYTEA,
    "unifiKeyAuthTag" BYTEA,
    "unifiKeyLastFour" TEXT,
    "connectionStatus" TEXT NOT NULL DEFAULT 'unconfigured',
    "connectionError" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "kind" "GroupKind" NOT NULL,
    "name" TEXT NOT NULL,
    "monogram" TEXT,
    "familyRole" "FamilyRole",
    "protected" BOOLEAN NOT NULL DEFAULT false,
    "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "scheduleDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "scheduleStart" TEXT,
    "scheduleEnd" TEXT,
    "suspensionActive" BOOLEAN NOT NULL DEFAULT false,
    "suspensionUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "kind" "AccountKind" NOT NULL,
    "passwordHash" TEXT,
    "isAdmin" BOOLEAN NOT NULL DEFAULT true,
    "groupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "kind" "SessionKind" NOT NULL,
    "accountId" TEXT,
    "username" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "username" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "mac" TEXT NOT NULL,
    "hostname" TEXT,
    "ip" TEXT,
    "networkId" TEXT,
    "zoneId" TEXT,
    "groupId" TEXT,
    "assignment" "AssignmentState" NOT NULL DEFAULT 'quarantined',
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppPolicy" (
    "id" TEXT NOT NULL,
    "connectionIdentity" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "unifiPolicyId" TEXT,
    "ownerScope" "PolicyOwnerScope" NOT NULL,
    "groupId" TEXT,
    "zoneId" TEXT NOT NULL,
    "ipVersion" "IpVersion" NOT NULL,
    "desiredFingerprint" TEXT NOT NULL,
    "desiredRevision" INTEGER NOT NULL,
    "observedEnabled" BOOLEAN,
    "observedFingerprint" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyOperation" (
    "id" TEXT NOT NULL,
    "intent" "PolicyOperationIntent" NOT NULL,
    "appPolicyId" TEXT,
    "connectionIdentity" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "payloadFingerprint" TEXT,
    "unifiPolicyId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "requestedRevision" INTEGER NOT NULL,
    "appliedRevision" INTEGER,
    "status" "ChangeStatus" NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeResult" (
    "id" TEXT NOT NULL,
    "syncRunId" TEXT,
    "requestedRevision" INTEGER NOT NULL,
    "appliedRevision" INTEGER,
    "status" "ChangeStatus" NOT NULL DEFAULT 'pending',
    "scope" TEXT NOT NULL,
    "deviceMac" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationLock" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "owner" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationLock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_username_key" ON "Account"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_username_idx" ON "Session"("username");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_username_createdAt_idx" ON "LoginAttempt"("username", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_ip_createdAt_idx" ON "LoginAttempt"("ip", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Device_mac_key" ON "Device"("mac");

-- CreateIndex
CREATE UNIQUE INDEX "AppPolicy_unifiPolicyId_key" ON "AppPolicy"("unifiPolicyId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginAttempt" ADD CONSTRAINT "LoginAttempt_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppPolicy" ADD CONSTRAINT "AppPolicy_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeResult" ADD CONSTRAINT "ChangeResult_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "SyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

