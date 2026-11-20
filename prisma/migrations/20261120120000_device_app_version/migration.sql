-- The app version a paired device last said it runs (src/server/device-token.ts). Apps before 2.0 never say.
ALTER TABLE "PairedDevice" ADD COLUMN "appVersion" TEXT;
