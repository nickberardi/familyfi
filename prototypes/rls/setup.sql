-- Prototype only (issue 374, step 2b): two tables made household-owned, row-level security on them,
-- and an application role that neither owns the tables nor bypasses RLS. Run as the owner after
-- the real migrations.
ALTER TABLE "Group"  ADD COLUMN "householdId" text NOT NULL DEFAULT NULLIF(current_setting('app.household_id', true), '');
ALTER TABLE "Device" ADD COLUMN "householdId" text NOT NULL DEFAULT NULLIF(current_setting('app.household_id', true), '');

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'familyfi_app') THEN
    CREATE ROLE familyfi_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO familyfi_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO familyfi_app;

ALTER TABLE "Group"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Group"  FORCE ROW LEVEL SECURITY;
ALTER TABLE "Device" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Device" FORCE ROW LEVEL SECURITY;
-- current_setting(..., true) is NULL in a session that never set it, but '' in one that set it
-- locally before (a pooled connection), so NULLIF makes both mean "no household": no rows, no writes.
CREATE POLICY household ON "Group"
  USING ("householdId" = NULLIF(current_setting('app.household_id', true), ''))
  WITH CHECK ("householdId" = NULLIF(current_setting('app.household_id', true), ''));
CREATE POLICY household ON "Device"
  USING ("householdId" = NULLIF(current_setting('app.household_id', true), ''))
  WITH CHECK ("householdId" = NULLIF(current_setting('app.household_id', true), ''));

INSERT INTO "Household" (id, "updatedAt") VALUES ('house-a', now()), ('house-b', now()) ON CONFLICT DO NOTHING;
