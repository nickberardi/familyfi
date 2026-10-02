-- An agent is a paired device whose grant, not its account, bounds what it may do.
ALTER TYPE "PairedDeviceClient" ADD VALUE 'agent';

CREATE TYPE "AgentGrant" AS ENUM ('read', 'controls');

ALTER TABLE "PairedDevice"
  ADD COLUMN "agentGrant" "AgentGrant",
  ADD COLUMN "accountId" TEXT;

ALTER TABLE "PairedDevice" ADD CONSTRAINT "PairedDevice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Pairing"
  ADD COLUMN "client" "PairedDeviceClient" NOT NULL DEFAULT 'phone',
  ADD COLUMN "agentGrant" "AgentGrant";
