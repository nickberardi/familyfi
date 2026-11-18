-- A child's phone (FamilyFi Me) tells its Screen Time permission, and parents hear when it goes quiet.
ALTER TABLE "PairedDevice" ADD COLUMN "protection" TEXT;
ALTER TABLE "PairedDevice" ADD COLUMN "protectionAt" TIMESTAMPTZ(3);
ALTER TABLE "PairedDevice" ADD COLUMN "quietAlertedAt" TIMESTAMPTZ(3);
