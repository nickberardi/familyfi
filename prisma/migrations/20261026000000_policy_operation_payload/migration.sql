-- The write a create sent, so a create whose answer was lost can be matched to the policy it made:
-- the gateway orders keys its own way and adds defaults, so a hash of the write cannot find it.

-- AlterTable
ALTER TABLE "PolicyOperation" ADD COLUMN     "payload" JSONB;
