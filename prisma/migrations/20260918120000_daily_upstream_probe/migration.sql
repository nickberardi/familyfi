-- The sweep ran on an interval counted from the last boot, so "daily" drifted with
-- every restart and the setting had no UI to reach it. It becomes a household-local
-- wall-clock schedule instead: a time of day plus the weekdays to run on, matching the
-- existing `scheduleStart`/`scheduleDays` idiom already used for bedtime schedules.
--
-- Pre-release, and nothing reads `dohProbeIntervalMinutes` outside the route handler it
-- came from, so it is replaced rather than migrated forward.
ALTER TABLE "Household" DROP COLUMN "dohProbeIntervalMinutes";
ALTER TABLE "Household" ADD COLUMN "dohProbeTime" TEXT NOT NULL DEFAULT '12:00';
ALTER TABLE "Household" ADD COLUMN "dohProbeDays" INTEGER[] NOT NULL DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6];

-- The most recent scheduled instant this household has actually swept for. Claimed
-- with a conditional update inside the existing upstream lock, this is what lets a
-- restart around the scheduled time catch up a missed run exactly once, and what keeps
-- two processes off the same run without a second lock table.
ALTER TABLE "Household" ADD COLUMN "dohProbeLastRunAt" TIMESTAMP(3);
