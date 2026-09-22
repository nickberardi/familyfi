CREATE TYPE "ConnectionTransport" AS ENUM ('lan', 'vpn', 'reverseProxy', 'tailscale', 'cloudflare');
CREATE TYPE "ConnectionTrustMode" AS ENUM ('system', 'pinned');

ALTER TABLE "Household"
  ADD COLUMN "displayName" TEXT NOT NULL DEFAULT 'FamilyFi household',
  ADD COLUMN "instanceId" TEXT,
  ADD COLUMN "instancePublicKey" TEXT,
  ADD COLUMN "instancePrivateKeyCiphertext" BYTEA,
  ADD COLUMN "instancePrivateKeyIv" BYTEA,
  ADD COLUMN "instancePrivateKeyAuthTag" BYTEA;
CREATE UNIQUE INDEX "Household_instanceId_key" ON "Household"("instanceId");

CREATE TABLE "ConnectionEndpoint" (
  "id" TEXT NOT NULL, "householdId" TEXT NOT NULL DEFAULT 'default', "url" TEXT NOT NULL,
  "transport" "ConnectionTransport" NOT NULL, "trustMode" "ConnectionTrustMode" NOT NULL DEFAULT 'system',
  "spkiSha256" TEXT, "priority" INTEGER NOT NULL DEFAULT 0, "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConnectionEndpoint_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ConnectionEndpoint_url_key" ON "ConnectionEndpoint"("url");
CREATE INDEX "ConnectionEndpoint_householdId_priority_idx" ON "ConnectionEndpoint"("householdId", "priority");
ALTER TABLE "ConnectionEndpoint" ADD CONSTRAINT "ConnectionEndpoint_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PairedDevice" (
  "id" TEXT NOT NULL, "displayName" TEXT NOT NULL, "credentialHash" TEXT NOT NULL,
  "revokedAt" TIMESTAMP(3), "lastSeenAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "PairedDevice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PairedDevice_credentialHash_key" ON "PairedDevice"("credentialHash");

CREATE TABLE "Pairing" (
  "id" TEXT NOT NULL, "householdId" TEXT NOT NULL DEFAULT 'default', "endpointId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL, "displayName" TEXT NOT NULL, "createdByAccountId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "claimedAt" TIMESTAMP(3), "claimedDeviceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "Pairing_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Pairing_tokenHash_key" ON "Pairing"("tokenHash");
CREATE UNIQUE INDEX "Pairing_claimedDeviceId_key" ON "Pairing"("claimedDeviceId");
CREATE INDEX "Pairing_expiresAt_idx" ON "Pairing"("expiresAt");
ALTER TABLE "Pairing" ADD CONSTRAINT "Pairing_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Pairing" ADD CONSTRAINT "Pairing_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "ConnectionEndpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Pairing" ADD CONSTRAINT "Pairing_claimedDeviceId_fkey" FOREIGN KEY ("claimedDeviceId") REFERENCES "PairedDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Session" ADD COLUMN "deviceId" TEXT;
CREATE INDEX "Session_deviceId_idx" ON "Session"("deviceId");
ALTER TABLE "Session" ADD CONSTRAINT "Session_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PairedDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ChangeResult" ADD COLUMN "actorAccountId" TEXT, ADD COLUMN "actorDeviceId" TEXT;
CREATE INDEX "ChangeResult_actorAccountId_updatedAt_idx" ON "ChangeResult"("actorAccountId", "updatedAt");
ALTER TABLE "ChangeResult" ADD CONSTRAINT "ChangeResult_actorAccountId_fkey" FOREIGN KEY ("actorAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChangeResult" ADD CONSTRAINT "ChangeResult_actorDeviceId_fkey" FOREIGN KEY ("actorDeviceId") REFERENCES "PairedDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
