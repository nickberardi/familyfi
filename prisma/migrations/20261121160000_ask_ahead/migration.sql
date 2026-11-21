-- How long before a block starts FamilyFi Me gives its heads-up, which is also how early a person can ask for more time (familyfi issue 457). 0 turns both off.
ALTER TABLE "Household" ADD COLUMN "askAheadMinutes" INTEGER NOT NULL DEFAULT 5;
