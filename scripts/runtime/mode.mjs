/**
 * `FAMILYFI_MODE` for the startup scripts, which run before the app and cannot import its
 * TypeScript. Mirrors `familyfiMode`, `modeIssues`, `inMemoryDatabase`, `memoryDatabase` and the
 * old database names in src/server/env.ts and src/server/database-url.ts;
 * tests/unit/familyfi-mode.test.ts holds them equal.
 */

/** @typedef {Record<string, string | undefined>} Env */

export const FAMILYFI_MODES = Object.freeze(["dev", "test", "demo", "prod"]);
export const MEMORY_DATABASE_PORT = "5433";

/** The database settings' names before they all took the `DB_` prefix, read while the new name is unset. */
export const OLD_DATABASE_NAMES = Object.freeze({
  DB_SERVER: "DB_MODE",
  DB_PORT: "POSTGRES_PORT",
  DB_NAME: "POSTGRES_DB",
  DB_USER: "POSTGRES_USER",
  DB_PASSWORD: "POSTGRES_PASSWORD",
});

/**
 * A setting, trimmed. A database setting falls back to its old name while unset.
 * @param {Env} env
 * @param {string} key
 */
export function setting(env, key) {
  const value = env[key]?.trim();
  if (value) return value;
  const old = OLD_DATABASE_NAMES[/** @type {keyof typeof OLD_DATABASE_NAMES} */ (key)];
  return (old && env[old]?.trim()) || value;
}

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
  return FAMILYFI_MODES.includes(value) ? value : "prod";
}

/** @param {Env} [env] */
export function modeIssues(env = process.env) {
  const issues = [];
  const refusal = modeRefusal(env);
  if (refusal) issues.push(refusal);
  if (setting(env, "DB_SERVER") === "memory" && familyfiMode(env) === "prod") {
    issues.push("DB_SERVER=memory is for dev, test and demo; prod keeps its household in PostgreSQL.");
  }
  return issues;
}

/** @param {Env} [env] */
export function inMemoryDatabase(env = process.env) {
  const mode = familyfiMode(env);
  return mode === "demo" || (mode !== "prod" && setting(env, "DB_SERVER") === "memory");
}

/** @param {string | undefined} [port] */
export function memoryDatabase(port) {
  return {
    DB_HOST: "127.0.0.1",
    DB_PORT: port || MEMORY_DATABASE_PORT,
    DB_NAME: "template1",
    DB_USER: "postgres",
    DB_PASSWORD: "postgres",
    DB_SSL_MODE: "disable",
  };
}
