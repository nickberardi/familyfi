-- No paired device acts as the recovery account. Phones, Watches and agents paired as it before this
-- rule are signed out and revoked, and invites for it still waiting are cancelled; each pairs again
-- as a personal administrator. The revoked records stay listed, so the household can see which to
-- pair again, until it clears them.

UPDATE "Session" SET "revokedAt" = CURRENT_TIMESTAMP
WHERE "revokedAt" IS NULL
  AND "deviceId" IS NOT NULL
  AND (
    "accountId" IN (SELECT "id" FROM "Account" WHERE "kind" = 'recovery')
    OR "deviceId" IN (SELECT d."id" FROM "PairedDevice" d JOIN "Account" a ON a."id" = d."accountId" WHERE a."kind" = 'recovery')
  );

UPDATE "PairedDevice" SET "revokedAt" = CURRENT_TIMESTAMP
WHERE "revokedAt" IS NULL
  AND "accountId" IN (SELECT "id" FROM "Account" WHERE "kind" = 'recovery');

UPDATE "Pairing" SET "expiresAt" = CURRENT_TIMESTAMP
WHERE "claimedAt" IS NULL
  AND "expiresAt" > CURRENT_TIMESTAMP
  AND "accountId" IN (SELECT "id" FROM "Account" WHERE "kind" = 'recovery');
