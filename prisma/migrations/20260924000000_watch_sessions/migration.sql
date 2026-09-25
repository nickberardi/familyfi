CREATE TYPE "PairedDeviceClient" AS ENUM ('phone', 'watch');
ALTER TABLE "PairedDevice" ADD COLUMN "client" "PairedDeviceClient" NOT NULL DEFAULT 'phone';
ALTER TABLE "PairedDevice" ADD COLUMN "clientId" TEXT;
CREATE UNIQUE INDEX "PairedDevice_clientId_key" ON "PairedDevice"("clientId");
