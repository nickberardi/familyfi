-- The whole schema, as of the flattened history (issue #153). It replaced every prerelease
-- migration, through 20261003100000_paired_invites; databases built by those are not upgraded.

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
CREATE TYPE "PairedDeviceClient" AS ENUM ('phone', 'watch', 'agent');

-- CreateEnum
CREATE TYPE "DeviceScope" AS ENUM ('full', 'rulesOnly', 'readOnly');

-- CreateEnum
CREATE TYPE "ConnectionTransport" AS ENUM ('lan', 'tailscale', 'cloudflare');

-- CreateEnum
CREATE TYPE "RouteKind" AS ENUM ('quick', 'domain', 'own');

-- CreateEnum
CREATE TYPE "ConnectionTrustMode" AS ENUM ('system', 'pinned');

-- CreateEnum
CREATE TYPE "EdgeAuth" AS ENUM ('none', 'serviceToken');

-- CreateEnum
CREATE TYPE "PolicyOwnerScope" AS ENUM ('group', 'quarantine');

-- CreateEnum
CREATE TYPE "IpVersion" AS ENUM ('ipv4', 'ipv6', 'dual');

-- CreateEnum
CREATE TYPE "PolicyOperationIntent" AS ENUM ('create', 'update', 'delete');

-- CreateEnum
CREATE TYPE "ChangeStatus" AS ENUM ('pending', 'applied', 'partial', 'failed', 'superseded');

-- CreateEnum
CREATE TYPE "RuleKind" AS ENUM ('category', 'app', 'internet', 'domain');

-- CreateEnum
CREATE TYPE "RuleMode" AS ENUM ('always', 'scheduled');

-- CreateEnum
CREATE TYPE "RuleLiftKind" AS ENUM ('pause', 'allow');

-- CreateEnum
CREATE TYPE "RuleScope" AS ENUM ('group', 'network');

-- CreateEnum
CREATE TYPE "UpstreamSource" AS ENUM ('seed', 'user');

-- CreateEnum
CREATE TYPE "UpstreamVerdict" AS ENUM ('blocked', 'partial', 'open', 'unknown');

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
    "unifiTlsInsecure" BOOLEAN NOT NULL DEFAULT false,
    "unifiManageAllNetworks" BOOLEAN NOT NULL DEFAULT false,
    "unifiManagedNetworkIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "quarantineEnforced" BOOLEAN NOT NULL DEFAULT true,
    "dohUrl" TEXT,
    "dohProbeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "dohProbeTime" TEXT NOT NULL DEFAULT '00:00',
    "dohProbeDays" INTEGER[] NOT NULL DEFAULT ARRAY[0]::INTEGER[],
    "dohProbeLastRunAt" TIMESTAMP(3),
    "dohProbeTimeoutMs" INTEGER NOT NULL DEFAULT 5000,
    "dohProbeDisabledAt" TIMESTAMP(3),
    "upstreamResolverSnapshot" JSONB,
    "connectionStatus" TEXT NOT NULL DEFAULT 'unconfigured',
    "connectionError" TEXT,
    "displayName" TEXT NOT NULL DEFAULT 'FamilyFi household',
    "instanceId" TEXT,
    "instancePublicKey" TEXT,
    "instancePrivateKeyCiphertext" BYTEA,
    "instancePrivateKeyIv" BYTEA,
    "instancePrivateKeyAuthTag" BYTEA,
    "remoteEndpointId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectionEndpoint" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL DEFAULT 'default',
    "url" TEXT NOT NULL,
    "kind" "RouteKind" NOT NULL DEFAULT 'own',
    "transport" "ConnectionTransport" NOT NULL,
    "trustMode" "ConnectionTrustMode" NOT NULL DEFAULT 'system',
    "spkiSha256" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "tunnelCredentialCiphertext" BYTEA,
    "tunnelCredentialIv" BYTEA,
    "tunnelCredentialAuthTag" BYTEA,
    "edgeAuth" "EdgeAuth" NOT NULL DEFAULT 'none',
    "edgeTokenCiphertext" BYTEA,
    "edgeTokenIv" BYTEA,
    "edgeTokenAuthTag" BYTEA,
    "edgeTokenVersion" INTEGER NOT NULL DEFAULT 0,
    "edgeTokenRotatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectionEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PairedDevice" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "client" "PairedDeviceClient" NOT NULL DEFAULT 'phone',
    "clientId" TEXT,
    "scope" "DeviceScope" NOT NULL DEFAULT 'full',
    "accountId" TEXT,
    "parentDeviceId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PairedDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceEdgeToken" (
    "deviceId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceEdgeToken_pkey" PRIMARY KEY ("deviceId","endpointId")
);

-- CreateTable
CREATE TABLE "Pairing" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL DEFAULT 'default',
    "endpointId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdByAccountId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "claimedDeviceId" TEXT,
    "accountId" TEXT,
    "parentDeviceId" TEXT,
    "replacesDeviceId" TEXT,
    "client" "PairedDeviceClient" NOT NULL DEFAULT 'phone',
    "scope" "DeviceScope",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pairing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "kind" "GroupKind" NOT NULL,
    "name" TEXT NOT NULL,
    "monogram" TEXT,
    "familyRole" "FamilyRole",
    "dohOverrideUrl" TEXT,
    "upstreamResolverSnapshot" JSONB,
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
    "deviceId" TEXT,
    "refreshTokenHash" TEXT,
    "refreshExpiresAt" TIMESTAMP(3),
    "previousRefreshHash" TEXT,
    "previousRefreshUntil" TIMESTAMP(3),
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
    "presenceOnline" BOOLEAN,
    "presenceCheckedAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3),
    "connectionType" TEXT,
    "accessPointName" TEXT,
    "manufacturer" TEXT,
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
    "actorAccountId" TEXT,
    "actorDeviceId" TEXT,

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

-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "useGeneratedName" BOOLEAN NOT NULL DEFAULT false,
    "kind" "RuleKind" NOT NULL,
    "scope" "RuleScope" NOT NULL DEFAULT 'group',
    "networkIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "targetIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "mode" "RuleMode" NOT NULL DEFAULT 'always',
    "pauseActive" BOOLEAN NOT NULL DEFAULT false,
    "pauseUntil" TIMESTAMP(3),
    "pauseKind" "RuleLiftKind" NOT NULL DEFAULT 'pause',
    "pausedByAccountId" TEXT,
    "pausedByName" TEXT,
    "systemGroupId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "blockedByAccountId" TEXT,
    "blockedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleGroup" (
    "ruleId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "pauseActive" BOOLEAN NOT NULL DEFAULT false,
    "pauseUntil" TIMESTAMP(3),
    "pauseKind" "RuleLiftKind" NOT NULL DEFAULT 'pause',
    "pausedByAccountId" TEXT,
    "pausedByName" TEXT,

    CONSTRAINT "RuleGroup_pkey" PRIMARY KEY ("ruleId","groupId")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "RulePolicy" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "windowKey" TEXT NOT NULL DEFAULT 'always',
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

    CONSTRAINT "RulePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpstreamCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "monogram" TEXT NOT NULL,
    "source" "UpstreamSource" NOT NULL DEFAULT 'user',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpstreamCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpstreamDomain" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "source" "UpstreamSource" NOT NULL,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpstreamDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpstreamCheck" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "groupId" TEXT,
    "verdict" "UpstreamVerdict" NOT NULL,
    "blockedCount" INTEGER NOT NULL,
    "totalCount" INTEGER NOT NULL,
    "results" JSONB NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER NOT NULL,
    "error" TEXT,
    "resolverContext" JSONB,
    "networkResults" JSONB,

    CONSTRAINT "UpstreamCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Household_instanceId_key" ON "Household"("instanceId");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectionEndpoint_url_key" ON "ConnectionEndpoint"("url");

-- CreateIndex
CREATE INDEX "ConnectionEndpoint_householdId_priority_idx" ON "ConnectionEndpoint"("householdId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "PairedDevice_clientId_key" ON "PairedDevice"("clientId");

-- CreateIndex
CREATE INDEX "DeviceEdgeToken_endpointId_idx" ON "DeviceEdgeToken"("endpointId");

-- CreateIndex
CREATE UNIQUE INDEX "Pairing_tokenHash_key" ON "Pairing"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Pairing_claimedDeviceId_key" ON "Pairing"("claimedDeviceId");

-- CreateIndex
CREATE INDEX "Pairing_expiresAt_idx" ON "Pairing"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Account_username_key" ON "Account"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Session_refreshTokenHash_key" ON "Session"("refreshTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Session_previousRefreshHash_key" ON "Session"("previousRefreshHash");

-- CreateIndex
CREATE INDEX "Session_username_idx" ON "Session"("username");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Session_deviceId_idx" ON "Session"("deviceId");

-- CreateIndex
CREATE INDEX "LoginAttempt_username_createdAt_idx" ON "LoginAttempt"("username", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_ip_createdAt_idx" ON "LoginAttempt"("ip", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Device_mac_key" ON "Device"("mac");

-- CreateIndex
CREATE UNIQUE INDEX "AppPolicy_unifiPolicyId_key" ON "AppPolicy"("unifiPolicyId");

-- CreateIndex
CREATE INDEX "ChangeResult_actorAccountId_updatedAt_idx" ON "ChangeResult"("actorAccountId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Rule_systemGroupId_key" ON "Rule"("systemGroupId");

-- CreateIndex
CREATE INDEX "Rule_scope_idx" ON "Rule"("scope");

-- CreateIndex
CREATE INDEX "RuleGroup_groupId_idx" ON "RuleGroup"("groupId");

-- CreateIndex
CREATE INDEX "RuleWindow_ruleId_idx" ON "RuleWindow"("ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "RulePolicy_unifiPolicyId_key" ON "RulePolicy"("unifiPolicyId");

-- CreateIndex
CREATE INDEX "RulePolicy_connectionIdentity_siteId_idx" ON "RulePolicy"("connectionIdentity", "siteId");

-- CreateIndex
CREATE UNIQUE INDEX "RulePolicy_ruleId_windowKey_connectionIdentity_siteId_zoneI_key" ON "RulePolicy"("ruleId", "windowKey", "connectionIdentity", "siteId", "zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "UpstreamCategory_slug_key" ON "UpstreamCategory"("slug");

-- CreateIndex
CREATE INDEX "UpstreamCategory_source_idx" ON "UpstreamCategory"("source");

-- CreateIndex
CREATE INDEX "UpstreamDomain_categoryId_idx" ON "UpstreamDomain"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "UpstreamDomain_categoryId_domain_key" ON "UpstreamDomain"("categoryId", "domain");

-- CreateIndex
CREATE INDEX "UpstreamCheck_checkedAt_idx" ON "UpstreamCheck"("checkedAt");

-- CreateIndex
CREATE INDEX "UpstreamCheck_groupId_idx" ON "UpstreamCheck"("groupId");

-- CreateIndex
-- NULLS NOT DISTINCT because the household row is keyed by a NULL groupId, and Postgres
-- otherwise treats every NULL as unique, which would let a concurrent sweep and a
-- "Check now" each insert their own household row for the same category. Prisma's
-- @@unique cannot express this, so the index is written by hand; introspection ignores
-- the clause, so this does not drift.
CREATE UNIQUE INDEX "UpstreamCheck_categoryId_groupId_key" ON "UpstreamCheck"("categoryId", "groupId") NULLS NOT DISTINCT;

-- AddForeignKey
ALTER TABLE "ConnectionEndpoint" ADD CONSTRAINT "ConnectionEndpoint_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PairedDevice" ADD CONSTRAINT "PairedDevice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PairedDevice" ADD CONSTRAINT "PairedDevice_parentDeviceId_fkey" FOREIGN KEY ("parentDeviceId") REFERENCES "PairedDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceEdgeToken" ADD CONSTRAINT "DeviceEdgeToken_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PairedDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceEdgeToken" ADD CONSTRAINT "DeviceEdgeToken_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "ConnectionEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pairing" ADD CONSTRAINT "Pairing_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pairing" ADD CONSTRAINT "Pairing_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "ConnectionEndpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pairing" ADD CONSTRAINT "Pairing_claimedDeviceId_fkey" FOREIGN KEY ("claimedDeviceId") REFERENCES "PairedDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pairing" ADD CONSTRAINT "Pairing_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pairing" ADD CONSTRAINT "Pairing_parentDeviceId_fkey" FOREIGN KEY ("parentDeviceId") REFERENCES "PairedDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PairedDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginAttempt" ADD CONSTRAINT "LoginAttempt_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppPolicy" ADD CONSTRAINT "AppPolicy_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeResult" ADD CONSTRAINT "ChangeResult_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "SyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeResult" ADD CONSTRAINT "ChangeResult_actorAccountId_fkey" FOREIGN KEY ("actorAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeResult" ADD CONSTRAINT "ChangeResult_actorDeviceId_fkey" FOREIGN KEY ("actorDeviceId") REFERENCES "PairedDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_systemGroupId_fkey" FOREIGN KEY ("systemGroupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleGroup" ADD CONSTRAINT "RuleGroup_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleGroup" ADD CONSTRAINT "RuleGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleWindow" ADD CONSTRAINT "RuleWindow_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RulePolicy" ADD CONSTRAINT "RulePolicy_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpstreamDomain" ADD CONSTRAINT "UpstreamDomain_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "UpstreamCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpstreamCheck" ADD CONSTRAINT "UpstreamCheck_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "UpstreamCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpstreamCheck" ADD CONSTRAINT "UpstreamCheck_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
