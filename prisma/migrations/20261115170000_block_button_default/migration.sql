-- A group's Block button default: one of its category, app or website rules, which the card's
-- Block button blocks and unblocks instead of all internet. Null keeps all internet. No foreign
-- key: a group's own block rule already points from Rule to Group, and deleting the rule clears it.
ALTER TABLE "Group" ADD COLUMN "blockButtonRuleId" TEXT;

-- The group's own block can block that rule's categories, apps or websites instead of all internet.
ALTER TABLE "Rule" ADD COLUMN "blocksRuleId" TEXT;
