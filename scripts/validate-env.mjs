#!/usr/bin/env node
import { applyDatabaseUrl } from "./print-database-url.mjs";
import { ensureSecrets, recoveryAdminBanner } from "./ensure-secrets.mjs";
import { assertEnv } from "./env-issues.mjs";

applyDatabaseUrl();
const result = ensureSecrets();
if (result.created.includes(".env")) console.log("wrote .env from .env.example");
if (result.written.length) {
  console.log(`generated ${result.written.join(", ")} in ${result.envPath}`);
}
if (result.written.includes("FAMILYFI_DEFAULT_PASSWORD")) {
  console.log(recoveryAdminBanner(result.defaultPassword));
}
assertEnv();
console.log("environment ok");
