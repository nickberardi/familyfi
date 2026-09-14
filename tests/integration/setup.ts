import { applyIntegrationEnv, ensureTestDatabase } from "../helpers/test-env";

applyIntegrationEnv();
await ensureTestDatabase();
