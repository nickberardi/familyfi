-- FamilyFi Me's Watch (`me-watch`, familyfi issue 460): set up by FamilyFi Me on a person's phone,
-- holding `me:askOnly` for the same family group. The scope list is unchanged.
ALTER TABLE "PairedDevice" DROP CONSTRAINT "PairedDevice_clientType_check";
ALTER TABLE "PairedDevice" ADD CONSTRAINT "PairedDevice_clientType_check" CHECK ("clientType" IN ('app', 'app-watch', 'app-controls', 'me', 'me-watch', 'agent'));
ALTER TABLE "Pairing" DROP CONSTRAINT "Pairing_clientType_check";
ALTER TABLE "Pairing" ADD CONSTRAINT "Pairing_clientType_check" CHECK ("clientType" IN ('app', 'app-watch', 'app-controls', 'me', 'me-watch', 'agent'));
