-- A rule's pause and allowance are told apart, and either can apply to one group alone.
CREATE TYPE "RuleLiftKind" AS ENUM ('pause', 'allow');

ALTER TABLE "Rule" ADD COLUMN "pauseKind" "RuleLiftKind" NOT NULL DEFAULT 'pause';

ALTER TABLE "RuleGroup"
  ADD COLUMN "pauseActive" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pauseUntil" TIMESTAMP(3),
  ADD COLUMN "pauseKind" "RuleLiftKind" NOT NULL DEFAULT 'pause',
  ADD COLUMN "pausedByAccountId" TEXT,
  ADD COLUMN "pausedByName" TEXT;
