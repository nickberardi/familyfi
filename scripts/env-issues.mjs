export function envIssues(env = process.env) {
  const issues = [];
  const password = env.DEFAULT_PASSWORD ?? "";
  if (password.length < 12) {
    issues.push("DEFAULT_PASSWORD must be at least 12 characters.");
  }
  const session = env.SESSION_SECRET ?? "";
  if (session.length < 32) {
    issues.push("SESSION_SECRET must be at least 32 characters.");
  }
  const key = env.APP_ENCRYPTION_KEY ?? "";
  const hex = /^[0-9a-fA-F]{64}$/.test(key);
  const b64 = Buffer.from(key, "base64").length === 32 && key.length >= 44;
  if (!hex && !b64) {
    issues.push("APP_ENCRYPTION_KEY must be 32 bytes as 64 hex characters (or base64).");
  }
  if (!env.POSTGRES_PASSWORD) {
    issues.push("POSTGRES_PASSWORD must be set.");
  }
  if (env.DB_MODE && !["bundled", "external"].includes(env.DB_MODE)) {
    issues.push("DB_MODE must be bundled or external.");
  }
  return issues;
}

export function assertEnv(env = process.env) {
  const issues = envIssues(env);
  if (!issues.length) return;
  console.error("FamilyFi is missing required settings in .env:");
  for (const issue of issues) console.error(`  - ${issue}`);
  console.error("Fix POSTGRES_PASSWORD in .env (and any other listed settings), then rerun.");
  process.exit(1);
}
