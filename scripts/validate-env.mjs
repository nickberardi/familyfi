#!/usr/bin/env node
import { applyDatabaseUrl } from "./print-database-url.mjs";

applyDatabaseUrl();

function fail(message) {
  console.error(message);
  process.exit(1);
}

const password = process.env.DEFAULT_PASSWORD ?? "";
if (password.length < 12) {
  fail("DEFAULT_PASSWORD must be set to at least 12 characters.");
}

const session = process.env.SESSION_SECRET ?? "";
if (session.length < 32) {
  fail("SESSION_SECRET must be set to at least 32 characters.");
}

const key = process.env.APP_ENCRYPTION_KEY ?? "";
const hex = /^[0-9a-fA-F]{64}$/.test(key);
const b64 = Buffer.from(key, "base64").length === 32 && key.length >= 44;
if (!hex && !b64) {
  fail("APP_ENCRYPTION_KEY must be 32 bytes as 64 hex characters (or base64).");
}

if (!process.env.DB_PASSWORD) {
  fail("DB_PASSWORD must be set.");
}

if (!["bundled", "external", undefined, ""].includes(process.env.DB_MODE)) {
  fail("DB_MODE must be bundled or external.");
}

console.log("environment ok");
