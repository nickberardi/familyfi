/**
 * `FAMILYFI_MODE` for the startup scripts, which run before the app and cannot import its
 * TypeScript. Mirrors `familyfiMode`, `modeIssues`, `inMemoryDatabase` and `memoryDatabase` in
 * src/server/env.ts and src/server/database-url.ts; tests/unit/familyfi-mode.test.ts holds them equal.
 */

/** @typedef {Record<string, string | undefined>} Env */

export const FAMILYFI_MODES = Object.freeze(["dev", "test", "demo", "prod"]);
export const MEMORY_DATABASE_PORT = "5433";

/** @param {string | undefined} value */
function truthy(value) {
  return ["1", "true", "yes"].includes((value ?? "").trim().toLowerCase());
}

/** @param {Env} env */
function requested(env) {
  return (env.FAMILYFI_MODE ?? "").trim().toLowerCase();
}

/** @param {Env} env */
function modeRefusal(env) {
  const value = requested(env);
  if (value && !FAMILYFI_MODES.includes(value)) return "FAMILYFI_MODE must be dev, test, demo or prod.";
  if (env.NODE_ENV !== "production") return undefined;
  if (value === "dev") return "FAMILYFI_MODE=dev is not allowed in production; use prod or demo.";
  if (value === "test" && !truthy(env.CI)) return "FAMILYFI_MODE=test runs in production only under CI; use prod or demo.";
  return undefined;
}

/** @param {Env} [env] */
export function familyfiMode(env = process.env) {
  if (modeRefusal(env)) return "prod";
  const value = requested(env);
  if (FAMILYFI_MODES.includes(value)) return value;
  // UNIFI_MOCK=1 is the deprecated name for dev, and never read in production.
  return truthy(env.UNIFI_MOCK) && env.NODE_ENV !== "production" ? "dev" : "prod";
}

/** @param {Env} [env] */
export function modeIssues(env = process.env) {
  const issues = [];
  const refusal = modeRefusal(env);
  if (refusal) issues.push(refusal);
  if ((env.DB_MODE ?? "").trim() === "memory" && familyfiMode(env) === "prod") {
    issues.push("DB_MODE=memory is for dev, test and demo; prod keeps its household in PostgreSQL.");
  }
  return issues;
}

/** @param {Env} [env] */
export function inMemoryDatabase(env = process.env) {
  const mode = familyfiMode(env);
  return mode === "demo" || (mode !== "prod" && (env.DB_MODE ?? "").trim() === "memory");
}

/** @param {string | undefined} [port] */
export function memoryDatabase(port) {
  return {
    DB_HOST: "127.0.0.1",
    POSTGRES_PORT: port || MEMORY_DATABASE_PORT,
    POSTGRES_DB: "template1",
    POSTGRES_USER: "postgres",
    POSTGRES_PASSWORD: "postgres",
    DB_SSL_MODE: "disable",
  };
}
