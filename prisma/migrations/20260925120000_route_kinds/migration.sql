-- Remote access publishes one route, and each route says who runs it. FamilyFi is pre-release:
-- no tunnel state is carried forward, so an upgraded database starts with remote access Off.

-- Home network covers LAN, VPN and reverse-proxy addresses alike: they were only ever labels.
ALTER TYPE "ConnectionTransport" RENAME TO "ConnectionTransport_old";
CREATE TYPE "ConnectionTransport" AS ENUM ('lan', 'tailscale', 'cloudflare');
ALTER TABLE "ConnectionEndpoint" ALTER COLUMN "transport" TYPE "ConnectionTransport"
  USING (CASE WHEN "transport"::text IN ('vpn', 'reverseProxy') THEN 'lan' ELSE "transport"::text END)::"ConnectionTransport";
DROP TYPE "ConnectionTransport_old";

CREATE TYPE "RouteKind" AS ENUM ('quick', 'domain', 'own');
ALTER TABLE "ConnectionEndpoint" ADD COLUMN "kind" "RouteKind" NOT NULL DEFAULT 'own';
ALTER TABLE "ConnectionEndpoint" ADD COLUMN "tunnelCredentialCiphertext" BYTEA;
ALTER TABLE "ConnectionEndpoint" ADD COLUMN "tunnelCredentialIv" BYTEA;
ALTER TABLE "ConnectionEndpoint" ADD COLUMN "tunnelCredentialAuthTag" BYTEA;

ALTER TABLE "Household" ADD COLUMN "remoteEndpointId" TEXT;
ALTER TABLE "Household" DROP COLUMN "tunnelMode";
ALTER TABLE "Household" DROP COLUMN "tunnelEndpointId";
ALTER TABLE "Household" DROP COLUMN "tunnelHostname";
ALTER TABLE "Household" DROP COLUMN "tunnelCredentialCiphertext";
ALTER TABLE "Household" DROP COLUMN "tunnelCredentialIv";
ALTER TABLE "Household" DROP COLUMN "tunnelCredentialAuthTag";
DROP TYPE "TunnelMode";
