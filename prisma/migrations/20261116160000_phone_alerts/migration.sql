-- Phone alerts (familyfi#263): the household's relay switch and relay credential, sync trouble
-- tracking, each paired app's push registration, and the alert outbox. Nothing existing changes.

-- CreateEnum
CREATE TYPE "PushPlatform" AS ENUM ('ios', 'android');

-- CreateEnum
CREATE TYPE "PushChannel" AS ENUM ('release', 'development');

-- AlterTable
ALTER TABLE "Household" ADD COLUMN     "alertsInstallId" TEXT,
ADD COLUMN     "alertsInstallSecretAuthTag" BYTEA,
ADD COLUMN     "alertsInstallSecretCiphertext" BYTEA,
ADD COLUMN     "alertsInstallSecretIv" BYTEA,
ADD COLUMN     "alertsRelayEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "syncFailingSince" TIMESTAMPTZ(3),
ADD COLUMN     "syncTroubleAlertedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "PushRegistration" (
    "deviceId" TEXT NOT NULL,
    "platform" "PushPlatform" NOT NULL,
    "channel" "PushChannel" NOT NULL,
    "tokenCiphertext" BYTEA NOT NULL,
    "tokenIv" BYTEA NOT NULL,
    "tokenAuthTag" BYTEA NOT NULL,
    "keyCiphertext" BYTEA NOT NULL,
    "keyIv" BYTEA NOT NULL,
    "keyAuthTag" BYTEA NOT NULL,
    "format" INTEGER NOT NULL,
    "supportedKinds" TEXT[],
    "mutedKinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PushRegistration_pkey" PRIMARY KEY ("deviceId")
);

-- CreateTable
CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlertEvent_sentAt_nextAttemptAt_idx" ON "AlertEvent"("sentAt", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "AlertEvent_deviceId_dedupeKey_key" ON "AlertEvent"("deviceId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "PushRegistration" ADD CONSTRAINT "PushRegistration_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PairedDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PairedDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

