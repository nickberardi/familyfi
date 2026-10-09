-- The latest install moves onto Household, and the schedule becomes one cron string. Nothing is
-- carried over: no release had the earlier columns, so every household starts from the defaults.

-- RenameEnum
ALTER TYPE "UpdateRunStatus" RENAME TO "UpdateStatus";

-- AlterTable
ALTER TABLE "Household" DROP COLUMN "autoUpdateDays",
DROP COLUMN "autoUpdateEnabled",
DROP COLUMN "autoUpdateLastRunAt",
DROP COLUMN "autoUpdateTime",
ADD COLUMN     "updateError" TEXT,
ADD COLUMN     "updateRequestedAt" TIMESTAMPTZ(3),
ADD COLUMN     "updateSchedule" TEXT NOT NULL DEFAULT '0 0 * * 0',
ADD COLUMN     "updateScheduleEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "updateScheduleLastRunAt" TIMESTAMPTZ(3),
ADD COLUMN     "updateStatus" "UpdateStatus",
ADD COLUMN     "updateTargetVersion" TEXT;

-- DropTable
DROP TABLE "UpdateRun";

-- DropEnum
DROP TYPE "UpdateTrigger";
