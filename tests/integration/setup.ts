import { applyIntegrationEnv, ensureTestDatabase } from "../helpers/test-env";

applyIntegrationEnv();
// scripts/test.py lists tests (`vitest list`) without a database; it sets this only while listing.
if (!process.env.FAMILYFI_TEST_DISCOVERY) await ensureTestDatabase();
