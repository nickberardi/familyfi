-- A child's phone (FamilyFi Me, client type `me`) signs in for its family group, never as an account.
-- Deleting the group revokes its devices in code before the link clears, so their records stay; an
-- invite left without its group can never be claimed.
ALTER TABLE "PairedDevice" ADD COLUMN "groupId" TEXT;
ALTER TABLE "Pairing" ADD COLUMN "groupId" TEXT;

ALTER TABLE "PairedDevice" ADD CONSTRAINT "PairedDevice_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Pairing" ADD CONSTRAINT "Pairing_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The phone that made a child's phone's invite: revoking it cancels the invite while it waits.
ALTER TABLE "Pairing" ADD COLUMN "madeByDeviceId" TEXT;
