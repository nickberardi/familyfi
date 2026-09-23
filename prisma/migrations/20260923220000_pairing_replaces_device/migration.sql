-- Re-pairing: the phone record a new pairing replaces once it is claimed.
ALTER TABLE "Pairing" ADD COLUMN "replacesDeviceId" TEXT;
