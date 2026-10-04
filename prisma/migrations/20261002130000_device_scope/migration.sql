-- Every paired device carries a scope; each (client, scope) pair is one allowlist. A new type
-- rather than renaming AgentGrant: Postgres cannot use an enum value added in the same transaction.
CREATE TYPE "DeviceScope" AS ENUM ('full', 'rulesOnly', 'readOnly');

ALTER TABLE "PairedDevice" ADD COLUMN "scope" "DeviceScope" NOT NULL DEFAULT 'full';
UPDATE "PairedDevice" SET "scope" = CASE
  WHEN "client" = 'watch' THEN 'rulesOnly'::"DeviceScope"
  WHEN "client" = 'agent' AND "agentGrant" = 'controls' THEN 'full'::"DeviceScope"
  WHEN "client" = 'agent' THEN 'readOnly'::"DeviceScope"
  ELSE 'full'::"DeviceScope"
END;
ALTER TABLE "PairedDevice" DROP COLUMN "agentGrant";

ALTER TABLE "Pairing" ADD COLUMN "scope" "DeviceScope";
UPDATE "Pairing" SET "scope" = CASE "agentGrant"
  WHEN 'controls' THEN 'full'::"DeviceScope"
  WHEN 'read' THEN 'readOnly'::"DeviceScope"
END
WHERE "agentGrant" IS NOT NULL;
ALTER TABLE "Pairing" DROP COLUMN "agentGrant";

DROP TYPE "AgentGrant";
