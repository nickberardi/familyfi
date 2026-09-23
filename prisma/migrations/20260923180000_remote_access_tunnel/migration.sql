-- Remote access: which Cloudflare tunnel FamilyFi runs, and the route it keeps pointed at it.
CREATE TYPE "TunnelMode" AS ENUM ('off', 'quick', 'named');
ALTER TABLE "Household" ADD COLUMN "tunnelMode" "TunnelMode" NOT NULL DEFAULT 'off';
ALTER TABLE "Household" ADD COLUMN "tunnelEndpointId" TEXT;
