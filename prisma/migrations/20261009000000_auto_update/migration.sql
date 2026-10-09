-- CreateEnum
CREATE TYPE "UpdateTrigger" AS ENUM ('manual', 'scheduled');

-- CreateEnum
CREATE TYPE "UpdateRunStatus" AS ENUM ('requested', 'succeeded', 'failed', 'skipped', 'unchanged');

-- AlterTable
ALTER TABLE "Household" ADD COLUMN     "autoUpdateDays" INTEGER[] DEFAULT ARRAY[0]::INTEGER[],
ADD COLUMN     "autoUpdateEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "autoUpdateLastRunAt" TIMESTAMPTZ(3),
ADD COLUMN     "autoUpdateTime" TEXT NOT NULL DEFAULT '00:00';

-- CreateTable
CREATE TABLE "UpdateRun" (
    "id" TEXT NOT NULL,
    "trigger" "UpdateTrigger" NOT NULL,
    "fromVersion" TEXT NOT NULL,
    "targetVersion" TEXT NOT NULL,
    "status" "UpdateRunStatus" NOT NULL DEFAULT 'requested',
    "requestedByAccountId" TEXT,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),
    "error" TEXT,

    CONSTRAINT "UpdateRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UpdateRun_requestedAt_idx" ON "UpdateRun"("requestedAt");

