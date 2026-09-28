-- Internet and website rules. The new values are used by the next migration, which
-- PostgreSQL only allows once this one has committed.
ALTER TYPE "RuleKind" ADD VALUE 'internet';
ALTER TYPE "RuleKind" ADD VALUE 'domain';
