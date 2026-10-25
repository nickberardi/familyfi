-- When the last sync pass checked every device's presence, so a device that stays offline is not
-- rewritten every pass.

-- AlterTable
ALTER TABLE "Household" ADD COLUMN     "presenceCheckedAt" TIMESTAMPTZ(3);
