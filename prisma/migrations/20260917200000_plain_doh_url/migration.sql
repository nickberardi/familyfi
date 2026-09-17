-- A resolver URL is configuration, not a credential. Its path may carry an account or
-- profile id, which lets someone spend that profile's quota and shows up in its logs,
-- but it cannot read those logs or change any setting. Encrypting it bought nothing:
-- there is no lesser-privileged reader to protect it from in a single-household
-- deployment, and anyone who can read this table can read FAMILYFI_ENCRYPTION_KEY from
-- the same host.
--
-- It cost three things. It put DNS checking inside the blast radius of an encryption
-- key rotation, which already breaks the UniFi key. It made the value write-only, so an
-- operator who mistyped a profile id saw a mask and an unknown verdict with no way to
-- spot the mistake. And it diverged from every comparable product — Pi-hole, AdGuard
-- Home and routers all keep upstream resolver URLs in plain config.
--
-- Pre-release, and the old values cannot be carried across anyway (they are AES-GCM
-- blobs keyed to whatever FAMILYFI_ENCRYPTION_KEY was in force), so the columns are
-- replaced rather than migrated. An operator re-pastes the endpoint in Categories.
ALTER TABLE "Household" DROP COLUMN "dohUrlCiphertext";
ALTER TABLE "Household" DROP COLUMN "dohUrlIv";
ALTER TABLE "Household" DROP COLUMN "dohUrlAuthTag";
ALTER TABLE "Household" DROP COLUMN "dohUrlMask";
ALTER TABLE "Household" ADD COLUMN "dohUrl" TEXT;

-- Kept, not dropped: a household may point one group at a different resolver, which is
-- a real setup and the reason a verdict has to be reported per resolver rather than
-- once for the house.
ALTER TABLE "Group" DROP COLUMN "dohOverrideCiphertext";
ALTER TABLE "Group" DROP COLUMN "dohOverrideIv";
ALTER TABLE "Group" DROP COLUMN "dohOverrideAuthTag";
ALTER TABLE "Group" DROP COLUMN "dohOverrideMask";
ALTER TABLE "Group" ADD COLUMN "dohOverrideUrl" TEXT;
