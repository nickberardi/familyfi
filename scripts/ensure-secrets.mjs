import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnvFile, resolveEnvPath } from "./print-database-url.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function isDefaultPasswordValid(value) {
  return typeof value === "string" && value.length >= 12;
}

export function isSessionSecretValid(value) {
  return typeof value === "string" && value.length >= 32;
}

export function isEncryptionKeyValid(value) {
  if (typeof value !== "string" || !value) return false;
  if (/^[0-9a-fA-F]{64}$/.test(value)) return true;
  return Buffer.from(value, "base64").length === 32 && value.length >= 44;
}

export function generateDefaultPassword() {
  return randomBytes(12).toString("base64url");
}

export function generateSessionSecret() {
  return randomBytes(32).toString("base64url");
}

export function generateEncryptionKey() {
  return randomBytes(32).toString("hex");
}

function nonempty(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : "";
}

function setEnvFileKey(contents, key, value) {
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(contents)) return contents.replace(pattern, `${key}=${value}`);
  const trimmed = contents.replace(/\s*$/, "");
  return `${trimmed}\n${key}=${value}\n`;
}

export function recoveryAdminBanner(password) {
  const line = "=".repeat(66);
  return [
    "",
    line,
    "  FamilyFi recovery admin",
    "    username: admin",
    `    password: ${password}`,
    "  This is FAMILYFI_DEFAULT_PASSWORD in .env. Change it there to pick your own.",
    line,
    "",
  ].join("\n");
}

export function ensureSecrets(options = {}) {
  const env = options.env ?? process.env;
  const envPath = options.envPath ?? resolveEnvPath(env);
  const examplePath = options.examplePath ?? path.join(root, ".env.example");
  const created = [];

  const processPassword = nonempty(env.FAMILYFI_DEFAULT_PASSWORD);
  const processSession = nonempty(env.FAMILYFI_SESSION_SECRET);
  const processKey = nonempty(env.FAMILYFI_ENCRYPTION_KEY);
  const processComplete =
    isDefaultPasswordValid(processPassword) &&
    isSessionSecretValid(processSession) &&
    isEncryptionKeyValid(processKey);

  if (!fs.existsSync(envPath)) {
    if (processComplete) {
      return { created, written: [], envPath, defaultPassword: processPassword };
    }
    if (!fs.existsSync(examplePath)) {
      throw new Error(`missing ${envPath} and ${examplePath}`);
    }
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    fs.copyFileSync(examplePath, envPath);
    created.push(".env");
  }

  let contents = fs.readFileSync(envPath, "utf8");
  const fileValues = parseEnvFile(contents);
  const written = [];
  const current = (key) => nonempty(env[key]) || nonempty(fileValues[key]);

  let password = current("FAMILYFI_DEFAULT_PASSWORD");
  if (!isDefaultPasswordValid(password)) {
    password = generateDefaultPassword();
    contents = setEnvFileKey(contents, "FAMILYFI_DEFAULT_PASSWORD", password);
    written.push("FAMILYFI_DEFAULT_PASSWORD");
  }
  env.FAMILYFI_DEFAULT_PASSWORD = password;

  let session = current("FAMILYFI_SESSION_SECRET");
  if (!isSessionSecretValid(session)) {
    session = generateSessionSecret();
    contents = setEnvFileKey(contents, "FAMILYFI_SESSION_SECRET", session);
    written.push("FAMILYFI_SESSION_SECRET");
  }
  env.FAMILYFI_SESSION_SECRET = session;

  let key = current("FAMILYFI_ENCRYPTION_KEY");
  if (!isEncryptionKeyValid(key)) {
    key = generateEncryptionKey();
    contents = setEnvFileKey(contents, "FAMILYFI_ENCRYPTION_KEY", key);
    written.push("FAMILYFI_ENCRYPTION_KEY");
  }
  env.FAMILYFI_ENCRYPTION_KEY = key;

  if (written.length) {
    try {
      fs.writeFileSync(envPath, contents, { encoding: "utf8", mode: 0o600 });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : "";
      if (code === "EACCES") {
        throw new Error("Cannot write generated secrets to .env. Make .env writable.");
      }
      throw error;
    }
  }
  return { created, written, envPath, defaultPassword: password };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = ensureSecrets();
    if (result.created.includes(".env")) console.log("wrote .env from .env.example");
    if (result.written.length) {
      console.log(`generated ${result.written.join(", ")} in ${result.envPath}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
