-- Drop the "Fam" prefix from the rules tables, enums and foreign keys.
-- Names now carry either the full product name or nothing at all; these
-- are internal, so they carry nothing.

ALTER TYPE "FamRuleKind" RENAME TO "RuleKind";
ALTER TYPE "FamRuleMode" RENAME TO "RuleMode";
ALTER TYPE "FamRuleScope" RENAME TO "RuleScope";

ALTER TABLE "FamRule" RENAME TO "Rule";
ALTER TABLE "FamRulePolicy" RENAME TO "RulePolicy";

ALTER TABLE "RulePolicy" RENAME COLUMN "famRuleId" TO "ruleId";

-- Constraints and indexes keep their old generated names after a table
-- rename, so bring them along for a clean `prisma migrate diff`.
ALTER TABLE "Rule" RENAME CONSTRAINT "FamRule_pkey" TO "Rule_pkey";
ALTER TABLE "Rule" RENAME CONSTRAINT "FamRule_groupId_fkey" TO "Rule_groupId_fkey";
ALTER INDEX "FamRule_groupId_idx" RENAME TO "Rule_groupId_idx";
ALTER INDEX "FamRule_scope_idx" RENAME TO "Rule_scope_idx";

ALTER TABLE "RulePolicy" RENAME CONSTRAINT "FamRulePolicy_pkey" TO "RulePolicy_pkey";
ALTER TABLE "RulePolicy" RENAME CONSTRAINT "FamRulePolicy_famRuleId_fkey" TO "RulePolicy_ruleId_fkey";
ALTER INDEX "FamRulePolicy_unifiPolicyId_key" RENAME TO "RulePolicy_unifiPolicyId_key";
ALTER INDEX "FamRulePolicy_famRuleId_connectionIdentity_siteId_zoneId_key" RENAME TO "RulePolicy_ruleId_connectionIdentity_siteId_zoneId_key";
ALTER INDEX "FamRulePolicy_connectionIdentity_siteId_idx" RENAME TO "RulePolicy_connectionIdentity_siteId_idx";
