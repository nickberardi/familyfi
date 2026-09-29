-- A rule can be paused: lifted for every group it covers until a time, or until resumed.
ALTER TABLE "Rule"
  ADD COLUMN "pauseActive" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pauseUntil" TIMESTAMP(3),
  ADD COLUMN "pausedByAccountId" TEXT,
  ADD COLUMN "pausedByName" TEXT;
