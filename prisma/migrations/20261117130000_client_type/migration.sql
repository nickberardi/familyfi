-- Who is talking and what it may do, as two separate values (src/lib/client-type.ts). The client
-- type (app, app-watch, app-controls, me, agent) replaces `client`, and the scope becomes one value,
-- `group:scope`. Every existing invite and device keeps what it had: nothing pairs again.
--   app + full        -> app          app:full
--   app + rulesOnly   -> app-controls app:rulesOnly   (Siri, Shortcuts and system controls)
--   watch + rulesOnly -> app-watch    app:rulesOnly
--   agent + full      -> agent        agent:full
--   agent + readOnly  -> agent        agent:readOnly

ALTER TABLE "PairedDevice" ADD COLUMN "clientType" TEXT NOT NULL DEFAULT 'app';
UPDATE "PairedDevice" SET "clientType" = CASE
  WHEN "client" = 'watch' THEN 'app-watch'
  WHEN "client" = 'agent' THEN 'agent'
  WHEN "scope" = 'rulesOnly' THEN 'app-controls'
  ELSE 'app'
END;
ALTER TABLE "PairedDevice" ALTER COLUMN "scope" DROP DEFAULT;
ALTER TABLE "PairedDevice" ALTER COLUMN "scope" TYPE TEXT
  USING (CASE WHEN "client" = 'agent' THEN 'agent:' ELSE 'app:' END) || "scope"::TEXT;
ALTER TABLE "PairedDevice" ALTER COLUMN "scope" SET DEFAULT 'app:full';
ALTER TABLE "PairedDevice" DROP COLUMN "client";

ALTER TABLE "Pairing" ADD COLUMN "clientType" TEXT NOT NULL DEFAULT 'app';
UPDATE "Pairing" SET "clientType" = CASE
  WHEN "client" = 'watch' THEN 'app-watch'
  WHEN "client" = 'agent' THEN 'agent'
  WHEN "scope" = 'rulesOnly' THEN 'app-controls'
  ELSE 'app'
END;
ALTER TABLE "Pairing" ALTER COLUMN "scope" TYPE TEXT
  USING CASE WHEN "scope" IS NULL THEN NULL ELSE (CASE WHEN "client" = 'agent' THEN 'agent:' ELSE 'app:' END) || "scope"::TEXT END;
ALTER TABLE "Pairing" DROP COLUMN "client";

DROP TYPE "PairedDeviceClient";
DROP TYPE "DeviceScope";

-- Only the known values are stored. Adding a client type or scope adds it here too.
ALTER TABLE "PairedDevice" ADD CONSTRAINT "PairedDevice_clientType_check" CHECK ("clientType" IN ('app', 'app-watch', 'app-controls', 'me', 'agent'));
ALTER TABLE "PairedDevice" ADD CONSTRAINT "PairedDevice_scope_check" CHECK ("scope" IN ('app:full', 'app:rulesOnly', 'agent:full', 'agent:readOnly', 'me:askOnly'));
ALTER TABLE "Pairing" ADD CONSTRAINT "Pairing_clientType_check" CHECK ("clientType" IN ('app', 'app-watch', 'app-controls', 'me', 'agent'));
ALTER TABLE "Pairing" ADD CONSTRAINT "Pairing_scope_check" CHECK ("scope" IS NULL OR "scope" IN ('app:full', 'app:rulesOnly', 'agent:full', 'agent:readOnly', 'me:askOnly'));
