import { applyIntegrationEnv, ensureTestDatabase } from "../helpers/test-env";

applyIntegrationEnv();
// scripts/test.py lists tests (`vitest list`) without a database; it sets this only while listing.
if (!process.env.FAMILYFI_TEST_DISCOVERY) await ensureTestDatabase();

// No integration test runs the host's pg_dump: its version need not match the test server's, and
// against the in-memory PGlite it clears the one shared session's search_path. The export tests set
// their own stand-in; this one says why there is no dump.
const { setDatabaseDumpForTests } = await import("@/server/database-dump");
setDatabaseDumpForTests(async () => ({ data: null, reason: "Integration tests do not run pg_dump." }));
