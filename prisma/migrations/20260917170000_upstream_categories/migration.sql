-- CreateEnum
CREATE TYPE "UpstreamSource" AS ENUM ('seed', 'user');

-- CreateEnum
CREATE TYPE "UpstreamVerdict" AS ENUM ('blocked', 'partial', 'open', 'unknown');

-- AlterTable: household DoH resolver (encrypted; mask is display-only)
ALTER TABLE "Household" ADD COLUMN "dohUrlCiphertext" BYTEA;
ALTER TABLE "Household" ADD COLUMN "dohUrlIv" BYTEA;
ALTER TABLE "Household" ADD COLUMN "dohUrlAuthTag" BYTEA;
ALTER TABLE "Household" ADD COLUMN "dohUrlMask" TEXT;
ALTER TABLE "Household" ADD COLUMN "dohProbeEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Household" ADD COLUMN "dohProbeIntervalMinutes" INTEGER NOT NULL DEFAULT 1440;
ALTER TABLE "Household" ADD COLUMN "dohProbeTimeoutMs" INTEGER NOT NULL DEFAULT 5000;

-- AlterTable: per-group resolver override; NULL inherits the household default
ALTER TABLE "Group" ADD COLUMN "dohOverrideCiphertext" BYTEA;
ALTER TABLE "Group" ADD COLUMN "dohOverrideIv" BYTEA;
ALTER TABLE "Group" ADD COLUMN "dohOverrideAuthTag" BYTEA;
ALTER TABLE "Group" ADD COLUMN "dohOverrideMask" TEXT;

-- CreateTable
CREATE TABLE "UpstreamCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "monogram" TEXT NOT NULL,
    "source" "UpstreamSource" NOT NULL DEFAULT 'user',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpstreamCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpstreamDomain" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "source" "UpstreamSource" NOT NULL,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpstreamDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpstreamCheck" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "verdict" "UpstreamVerdict" NOT NULL,
    "blockedCount" INTEGER NOT NULL,
    "totalCount" INTEGER NOT NULL,
    "results" JSONB NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER NOT NULL,
    "error" TEXT,

    CONSTRAINT "UpstreamCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UpstreamCategory_slug_key" ON "UpstreamCategory"("slug");

-- CreateIndex
CREATE INDEX "UpstreamCategory_source_idx" ON "UpstreamCategory"("source");

-- CreateIndex
CREATE INDEX "UpstreamDomain_categoryId_idx" ON "UpstreamDomain"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "UpstreamDomain_categoryId_domain_key" ON "UpstreamDomain"("categoryId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "UpstreamCheck_categoryId_key" ON "UpstreamCheck"("categoryId");

-- CreateIndex
CREATE INDEX "UpstreamCheck_checkedAt_idx" ON "UpstreamCheck"("checkedAt");

-- AddForeignKey
ALTER TABLE "UpstreamDomain" ADD CONSTRAINT "UpstreamDomain_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "UpstreamCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpstreamCheck" ADD CONSTRAINT "UpstreamCheck_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "UpstreamCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
