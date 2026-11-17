-- Asking for more time (FamilyFi Me): a child's phone asks on its own group, and a parent answers.
CREATE TYPE "AskState" AS ENUM ('waiting', 'yes', 'no', 'timedOut', 'ended');

ALTER TABLE "Household" ADD COLUMN "askTimeoutMinutes" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "Household" ADD COLUMN "askWaitMinutes" INTEGER NOT NULL DEFAULT 30;

CREATE TABLE "Ask" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "deviceId" TEXT,
    "about" TEXT NOT NULL,
    "ruleId" TEXT,
    "minutes" INTEGER,
    "state" "AskState" NOT NULL DEFAULT 'waiting',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "endsWithBlock" BOOLEAN NOT NULL DEFAULT false,
    "answeredAt" TIMESTAMPTZ(3),
    "answeredByAccountId" TEXT,
    "answeredByName" TEXT,
    "askAgainAt" TIMESTAMPTZ(3),

    CONSTRAINT "Ask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Ask_groupId_createdAt_idx" ON "Ask"("groupId", "createdAt");
CREATE INDEX "Ask_state_expiresAt_idx" ON "Ask"("state", "expiresAt");

ALTER TABLE "Ask" ADD CONSTRAINT "Ask_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Ask" ADD CONSTRAINT "Ask_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PairedDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
