import { inMemoryDatabase, modeIssues, setting } from "./mode.mjs";

/** @param {Record<string, string | undefined>} [env] */
export function envIssues(env = process.env) {
  const issues = [];
  const password = env.FAMILYFI_DEFAULT_PASSWORD ?? "";
  if (password.length < 12) {
    issues.push("FAMILYFI_DEFAULT_PASSWORD must be at least 12 characters.");
  }
  const session = env.FAMILYFI_SESSION_SECRET ?? "";
  if (session.length < 32) {
    issues.push("FAMILYFI_SESSION_SECRET must be at least 32 characters.");
  }
  const key = env.FAMILYFI_ENCRYPTION_KEY ?? "";
  const hex = /^[0-9a-fA-F]{64}$/.test(key);
  const b64 = Buffer.from(key, "base64").length === 32 && key.length >= 44;
  if (!hex && !b64) {
    issues.push("FAMILYFI_ENCRYPTION_KEY must be 32 bytes as 64 hex characters (or base64).");
  }
  issues.push(...modeIssues(env));
  // The in-memory database brings its own settings (mode.mjs).
  if (!setting(env, "DB_PASSWORD") && !inMemoryDatabase(env)) {
    issues.push("DB_PASSWORD must be set.");
  }
  const server = setting(env, "DB_SERVER");
  if (server && !["bundled", "external", "memory"].includes(server)) {
    issues.push("DB_SERVER must be bundled, external or memory.");
  }
  return issues;
}

export function assertEnv(env = process.env) {
  const issues = envIssues(env);
  if (!issues.length) return;
  console.error("FamilyFi is missing required settings in .env:");
  for (const issue of issues) console.error(`  - ${issue}`);
  console.error("Fix DB_PASSWORD in .env (and any other listed settings), then rerun.");
  process.exit(1);
}
