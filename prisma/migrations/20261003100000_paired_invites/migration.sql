-- Pairing becomes the authentication: an invite names the account its device acts as, and a
-- paired device signs in with no password, so the device credential goes.

-- Every paired device acts as an account. Phones and Watches take the account of their latest sign-in.
UPDATE "PairedDevice" AS d SET "accountId" = s."accountId"
FROM (
  SELECT DISTINCT ON ("deviceId") "deviceId", "accountId"
  FROM "Session"
  WHERE "deviceId" IS NOT NULL AND "accountId" IS NOT NULL
  ORDER BY "deviceId", "createdAt" DESC
) AS s
WHERE d."id" = s."deviceId" AND d."accountId" IS NULL;

ALTER TABLE "PairedDevice" DROP COLUMN "credentialHash";
ALTER TABLE "PairedDevice" ADD COLUMN "parentDeviceId" TEXT;
ALTER TABLE "PairedDevice" ADD CONSTRAINT "PairedDevice_parentDeviceId_fkey" FOREIGN KEY ("parentDeviceId") REFERENCES "PairedDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- An invite acts as the account that made it. One whose maker no longer exists keeps its row with no
-- account and can never be claimed; invites are short-lived, so it has long expired anyway.
ALTER TABLE "Pairing" ADD COLUMN "accountId" TEXT;
UPDATE "Pairing" SET "accountId" = "createdByAccountId" WHERE "createdByAccountId" IN (SELECT "id" FROM "Account");
ALTER TABLE "Pairing" ADD CONSTRAINT "Pairing_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- A phone invite made before scopes were written on it still admits a full-access phone.
UPDATE "Pairing" SET "scope" = 'full' WHERE "client" = 'phone' AND "scope" IS NULL;
ALTER TABLE "Pairing" ADD COLUMN "parentDeviceId" TEXT;
ALTER TABLE "Pairing" ADD CONSTRAINT "Pairing_parentDeviceId_fkey" FOREIGN KEY ("parentDeviceId") REFERENCES "PairedDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
