-- Sync history is pruned each pass and its latest run is read on every status poll; change
-- results are listed by update time, settled by status, and unlinked when their run is pruned.

-- CreateIndex
CREATE INDEX "SyncRun_startedAt_idx" ON "SyncRun"("startedAt");

-- CreateIndex
CREATE INDEX "ChangeResult_updatedAt_idx" ON "ChangeResult"("updatedAt");

-- CreateIndex
CREATE INDEX "ChangeResult_status_idx" ON "ChangeResult"("status");

-- CreateIndex
CREATE INDEX "ChangeResult_syncRunId_idx" ON "ChangeResult"("syncRunId");
