-- "Use my domain": the hostname and the one tunnel-scoped credential, encrypted with FAMILYFI_ENCRYPTION_KEY.
ALTER TABLE "Household" ADD COLUMN "tunnelHostname" TEXT;
ALTER TABLE "Household" ADD COLUMN "tunnelCredentialCiphertext" BYTEA;
ALTER TABLE "Household" ADD COLUMN "tunnelCredentialIv" BYTEA;
ALTER TABLE "Household" ADD COLUMN "tunnelCredentialAuthTag" BYTEA;
