import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildDatabaseUrl, OLD_DATABASE_NAMES } from "@/server/database-url";
import { createPrismaClient } from "@/server/db";
import { resetEnvCacheForTests } from "@/server/env";

export const TEST_DB_NAME = "familyfi_test";
export const TEST_ORIGIN = "http://familyfi.test";

const ROOT = path.resolve(__dirname, "../..");
function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
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

function loadDotEnvIfPresent() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const parsed = parseEnvFile(fs.readFileSync(envPath, "utf8")) as Record<string, string>;
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined || process.env[key] === "") process.env[key] = value;
  }
}

export function applyIntegrationEnv() {
  loadDotEnvIfPresent();
  (process.env as Record<string, string | undefined>).NODE_ENV = "test";
  // A developer's .env may still use the database settings' old names; tests read only the new ones.
  for (const [name, old] of Object.entries(OLD_DATABASE_NAMES)) {
    process.env[name] ||= process.env[old];
    delete process.env[old];
  }
  process.env.DB_SERVER = "external";
  // Each test picks its own mode; a developer's .env must not.
  delete process.env.FAMILYFI_MODE;
  process.env.DB_NAME = TEST_DB_NAME;
  process.env.FAMILYFI_DEFAULT_PASSWORD ||= "ci-recovery-password";
  process.env.FAMILYFI_SESSION_SECRET ||= "ci-only-session-secret-32chars!!";
  process.env.FAMILYFI_ENCRYPTION_KEY ||=
    "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
  if (!process.env.DB_PASSWORD) {
    throw new Error("DB_PASSWORD is required for integration tests (use .env or CI env).");
  }
  process.env.DATABASE_URL = buildDatabaseUrl({
    DB_HOST: process.env.DB_HOST,
    DB_PORT: process.env.DB_PORT,
    DB_NAME: TEST_DB_NAME,
    DB_USER: process.env.DB_USER,
    DB_PASSWORD: process.env.DB_PASSWORD,
    DB_SSL_MODE: process.env.DB_SSL_MODE,
    DB_SSL_ROOT_CERT: process.env.DB_SSL_ROOT_CERT,
  });
  resetEnvCacheForTests();
}

export async function ensureTestDatabase() {
  const adminUrl = buildDatabaseUrl({
    DB_HOST: process.env.DB_HOST,
    DB_PORT: process.env.DB_PORT,
    DB_NAME: "postgres",
    DB_USER: process.env.DB_USER,
    DB_PASSWORD: process.env.DB_PASSWORD,
    DB_SSL_MODE: process.env.DB_SSL_MODE,
    DB_SSL_ROOT_CERT: process.env.DB_SSL_ROOT_CERT,
  });
  const admin = createPrismaClient(adminUrl);
  try {
    await admin.$connect();
  } catch (error) {
    throw new Error(
      `PostgreSQL is not reachable for integration tests (${String(error)}). Start it with make db-dev.`,
    );
  }
  try {
    const rows = await admin.$queryRawUnsafe<{ datname: string }[]>(
      `SELECT datname FROM pg_database WHERE datname = '${TEST_DB_NAME}'`,
    );
    if (rows.length === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE ${TEST_DB_NAME}`);
    }
  } finally {
    await admin.$disconnect();
  }

  execFileSync(path.join(ROOT, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: ROOT,
    env: process.env,
    stdio: "pipe",
  });
}
