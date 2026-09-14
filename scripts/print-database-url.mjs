#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

export function loadDotEnv() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  const parsed = parseEnvFile(fs.readFileSync(envPath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function buildDatabaseUrl(env = process.env) {
  const host = env.DB_HOST || "127.0.0.1";
  const port = env.DB_PORT || "5432";
  const name = env.DB_NAME || "familyfi";
  const user = env.DB_USER || "familyfi";
  const password = env.DB_PASSWORD ?? "";
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
