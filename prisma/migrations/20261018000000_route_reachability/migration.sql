-- Whether a route the household runs is reachable: the last request through it and FamilyFi's own check.

-- CreateEnum
CREATE TYPE "RouteCheckResult" AS ENUM ('reached', 'failed');

-- AlterTable
ALTER TABLE "ConnectionEndpoint" ADD COLUMN     "checkMessage" TEXT,
ADD COLUMN     "checkResult" "RouteCheckResult",
ADD COLUMN     "checkedAt" TIMESTAMPTZ(3),
ADD COLUMN     "reachedAt" TIMESTAMPTZ(3);
