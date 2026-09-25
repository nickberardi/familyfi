-- An `own` Cloudflare route may sit behind Cloudflare Access. Its service token is stored encrypted on the
-- route, and each device's last-served token version is recorded so a rotation can tell who still has the old one.

-- CreateEnum
CREATE TYPE "EdgeAuth" AS ENUM ('none', 'serviceToken');

-- AlterTable
ALTER TABLE "ConnectionEndpoint" ADD COLUMN     "edgeAuth" "EdgeAuth" NOT NULL DEFAULT 'none',
ADD COLUMN     "edgeTokenAuthTag" BYTEA,
ADD COLUMN     "edgeTokenCiphertext" BYTEA,
ADD COLUMN     "edgeTokenIv" BYTEA,
ADD COLUMN     "edgeTokenRotatedAt" TIMESTAMP(3),
ADD COLUMN     "edgeTokenVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DeviceEdgeToken" (
    "deviceId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceEdgeToken_pkey" PRIMARY KEY ("deviceId","endpointId")
);

-- CreateIndex
CREATE INDEX "DeviceEdgeToken_endpointId_idx" ON "DeviceEdgeToken"("endpointId");

-- AddForeignKey
ALTER TABLE "DeviceEdgeToken" ADD CONSTRAINT "DeviceEdgeToken_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PairedDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceEdgeToken" ADD CONSTRAINT "DeviceEdgeToken_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "ConnectionEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

