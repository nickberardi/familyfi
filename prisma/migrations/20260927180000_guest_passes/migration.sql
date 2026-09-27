CREATE TABLE "GuestPass" (
    "id" TEXT NOT NULL,
    "connectionIdentity" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "mac" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "authorizedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GuestPass_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GuestPass_connectionIdentity_siteId_clientId_idx" ON "GuestPass"("connectionIdentity", "siteId", "clientId");

CREATE TABLE "GuestVoucher" (
    "id" TEXT NOT NULL,
    "connectionIdentity" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "unifiVoucherId" TEXT,
    "timeLimitMinutes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GuestVoucher_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GuestVoucher_unifiVoucherId_key" ON "GuestVoucher"("unifiVoucherId");
CREATE INDEX "GuestVoucher_connectionIdentity_siteId_idx" ON "GuestVoucher"("connectionIdentity", "siteId");
