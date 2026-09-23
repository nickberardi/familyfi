-- A deleted route keeps its claimed pairings as history instead of blocking the delete.
ALTER TABLE "Pairing" DROP CONSTRAINT "Pairing_endpointId_fkey";
ALTER TABLE "Pairing" ALTER COLUMN "endpointId" DROP NOT NULL;
ALTER TABLE "Pairing" ADD CONSTRAINT "Pairing_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "ConnectionEndpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
