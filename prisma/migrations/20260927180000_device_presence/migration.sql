ALTER TABLE "Device"
  ADD COLUMN "presenceOnline" BOOLEAN,
  ADD COLUMN "presenceCheckedAt" TIMESTAMP(3),
  ADD COLUMN "connectedAt" TIMESTAMP(3),
  ADD COLUMN "connectionType" TEXT,
  ADD COLUMN "accessPointName" TEXT;
