#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function parseEnvFile(contents) {
  const out = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Docker/standard data dir for persisted secrets. Not configurable via env. */
export const DATA_DIR = "/var/lib/familyfi/data";

/**
 * Env file path the app chooses:
 * - `/var/lib/familyfi/data/.env` when that data dir exists (container volume) or under Docker
 * - otherwise repo-root `.env` for local setup
 */
export function resolveEnvPath(env = /** @type {Record<string, string | undefined>} */ (process.env), rootDir = root) {
  const underDocker = fs.existsSync("/.dockerenv");
  if (underDocker || fs.existsSync(DATA_DIR)) {
    return path.join(DATA_DIR, ".env");
  }
  return path.join(rootDir, ".env");
}

export function loadDotEnv() {
  const envPath = resolveEnvPath();
  if (!fs.existsSync(envPath)) return;
  const parsed = parseEnvFile(fs.readFileSync(envPath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined || process.env[key] === "") process.env[key] = value;
  }
}

/**
 * True when FAMILYFI_DEMO is 1/true/yes, as `demoModeEnabled` in src/server/env.ts reads it.
 * @param {Record<string, string | undefined>} [env]
 */
export function demoRequested(env = process.env) {
  return ["1", "true", "yes"].includes((env.FAMILYFI_DEMO ?? "").trim().toLowerCase());
}

/** Demo mode's in-memory database, served by demo.mjs. Mirrors `DEMO_DATABASE` in src/server/database-url.ts. */
export const DEMO_DATABASE = Object.freeze({
  DB_HOST: "127.0.0.1",
  POSTGRES_PORT: "5433",
  POSTGRES_DB: "template1",
  POSTGRES_USER: "postgres",
  POSTGRES_PASSWORD: "postgres",
  DB_SSL_MODE: "disable",
});

/** @param {Record<string, string | undefined>} [source] */
export function buildDatabaseUrl(source = process.env) {
  const env = demoRequested(source) ? { ...source, DB_SSL_ROOT_CERT: undefined, ...DEMO_DATABASE } : source;
  const host = env.DB_HOST || "127.0.0.1";
  const port = env.POSTGRES_PORT || "5432";
  const name = env.POSTGRES_DB || "familyfi";
  const user = env.POSTGRES_USER || "familyfi";
  const password = env.POSTGRES_PASSWORD ?? "";
  const sslMode = env.DB_SSL_MODE;
  const sslRoot = env.DB_SSL_ROOT_CERT;
  let url = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(name)}`;
  const params = [];
  if (sslMode) params.push(`sslmode=${encodeURIComponent(sslMode)}`);
  if (sslRoot) params.push(`sslrootcert=${encodeURIComponent(sslRoot)}`);
  if (params.length) url += `?${params.join("&")}`;
  return url;
}

export function applyDatabaseUrl() {
  loadDotEnv();
  process.env.DATABASE_URL = buildDatabaseUrl();
  return process.env.DATABASE_URL;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${applyDatabaseUrl()}\n`);
}
