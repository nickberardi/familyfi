-- The ownership guard looks creations up by policy id on every update and delete, and each sync
-- pass reads this console's applied creations.

-- CreateIndex
CREATE INDEX "PolicyOperation_unifiPolicyId_idx" ON "PolicyOperation"("unifiPolicyId");

-- CreateIndex
CREATE INDEX "PolicyOperation_connectionIdentity_siteId_intent_status_idx" ON "PolicyOperation"("connectionIdentity", "siteId", "intent", "status");
