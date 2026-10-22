-- Recommended protection and network checkup: the built-in Block countries rule's list, and what the
-- network checkup last saw.

-- AlterTable
ALTER TABLE "Rule" ADD COLUMN     "countries" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Household" ADD COLUMN     "checkupError" TEXT,
ADD COLUMN     "checkupRanAt" TIMESTAMPTZ(3),
ADD COLUMN     "checkupSkipped" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "CheckupFinding" (
    "key" TEXT NOT NULL,
    "check" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "subject" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissedAt" TIMESTAMPTZ(3),
    "dismissedSubject" TEXT,

    CONSTRAINT "CheckupFinding_pkey" PRIMARY KEY ("key")
);
