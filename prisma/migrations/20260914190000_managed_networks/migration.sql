-- AlterTable
ALTER TABLE "Household" ADD COLUMN "unifiManageAllNetworks" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Household" ADD COLUMN "unifiManagedNetworkIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
