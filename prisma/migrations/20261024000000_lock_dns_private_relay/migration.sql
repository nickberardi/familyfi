-- Lock DNS can also turn off iCloud Private Relay (experimental), and keeps the DNS it left open at its
-- last sync for its page.

-- AlterTable
ALTER TABLE "Rule" ADD COLUMN     "blockPrivateRelay" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "openDns" JSONB NOT NULL DEFAULT '[]';
