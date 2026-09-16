-- CreateEnum
CREATE TYPE "GroupMode" AS ENUM ('always', 'scheduled');

-- AlterTable
ALTER TABLE "Group" ADD COLUMN "mode" "GroupMode" NOT NULL DEFAULT 'always';

-- D11: scheduleEnabled=true → scheduled; false → always (protected stay always / no policy)
UPDATE "Group" SET "mode" = 'scheduled' WHERE "scheduleEnabled" = true AND "protected" = false;
UPDATE "Group" SET "mode" = 'always' WHERE "scheduleEnabled" = false OR "protected" = true;
