-- What someone changed on a FamilyFi policy in the UniFi console, which sync put back.
ALTER TABLE "AppPolicy" ADD COLUMN "gatewayDrift" JSONB,
ADD COLUMN "driftSeenAt" TIMESTAMPTZ(3);

ALTER TABLE "RulePolicy" ADD COLUMN "gatewayDrift" JSONB,
ADD COLUMN "driftSeenAt" TIMESTAMPTZ(3);
