-- New households use a weekly schedule. Existing settings remain as saved.
ALTER TABLE "Household" ALTER COLUMN "dohProbeEnabled" SET DEFAULT true;
ALTER TABLE "Household" ALTER COLUMN "dohProbeTime" SET DEFAULT '00:00';
ALTER TABLE "Household" ALTER COLUMN "dohProbeDays" SET DEFAULT ARRAY[0];

ALTER TABLE "Household" ADD COLUMN "upstreamResolverSnapshot" JSONB;
ALTER TABLE "Household" ADD COLUMN "dohProbeDisabledAt" TIMESTAMP(3);
ALTER TABLE "Group" ADD COLUMN "upstreamResolverSnapshot" JSONB;
ALTER TABLE "UpstreamCategory" ADD COLUMN "disabledAt" TIMESTAMP(3);
ALTER TABLE "UpstreamCheck" ADD COLUMN "resolverContext" JSONB;
ALTER TABLE "UpstreamCheck" ADD COLUMN "networkResults" JSONB;

-- Old checks have no source identity. Retain their rows for migration integrity,
-- but expire them so no pre-upgrade verdict appears as a current observation.
UPDATE "UpstreamCheck" SET "checkedAt" = TIMESTAMP '1970-01-01 00:00:00';
