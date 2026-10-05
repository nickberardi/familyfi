-- A new household starts with quarantine off, so the administrator's own devices stay online
-- while they set up groups. Existing households keep the setting they have.
ALTER TABLE "Household" ALTER COLUMN "quarantineEnforced" SET DEFAULT false;
