-- The history prune, every pass, filters policy operations on status and age.

-- CreateIndex
CREATE INDEX "PolicyOperation_status_updatedAt_idx" ON "PolicyOperation"("status", "updatedAt");
