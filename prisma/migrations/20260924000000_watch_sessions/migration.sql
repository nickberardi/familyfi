ALTER TABLE "Session" ADD COLUMN "parentSessionId" TEXT;
ALTER TABLE "Session" ADD COLUMN "watchId" TEXT;

CREATE INDEX "Session_parentSessionId_idx" ON "Session"("parentSessionId");
