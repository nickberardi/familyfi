-- A paired device's bearer becomes short-lived and is renewed with a rotating refresh token.
ALTER TABLE "Session"
  ADD COLUMN "refreshTokenHash" TEXT,
  ADD COLUMN "refreshExpiresAt" TIMESTAMP(3),
  ADD COLUMN "previousRefreshHash" TEXT,
  ADD COLUMN "previousRefreshUntil" TIMESTAMP(3);

CREATE UNIQUE INDEX "Session_refreshTokenHash_key" ON "Session"("refreshTokenHash");
CREATE UNIQUE INDEX "Session_previousRefreshHash_key" ON "Session"("previousRefreshHash");
