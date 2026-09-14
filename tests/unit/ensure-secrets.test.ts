import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureSecrets,
  isDefaultPasswordValid,
  isEncryptionKeyValid,
  isSessionSecretValid,
} from "../../scripts/ensure-secrets.mjs";

describe("ensureSecrets", () => {
  it("writes recovery password and crypto secrets when missing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "familyfi-env-"));
    const envPath = path.join(dir, ".env");
    const examplePath = path.join(dir, ".env.example");
    writeFileSync(examplePath, "DEFAULT_PASSWORD=\nDB_PASSWORD=\n");
    const env: Record<string, string | undefined> = {};
    const result = ensureSecrets({ envPath, examplePath, env });
    expect(result.written).toEqual(["DEFAULT_PASSWORD", "SESSION_SECRET", "APP_ENCRYPTION_KEY"]);
    const file = readFileSync(envPath, "utf8");
    expect(isDefaultPasswordValid(env.DEFAULT_PASSWORD)).toBe(true);
    expect(isSessionSecretValid(env.SESSION_SECRET)).toBe(true);
    expect(isEncryptionKeyValid(env.APP_ENCRYPTION_KEY)).toBe(true);
    expect(file).toContain(`DEFAULT_PASSWORD=${env.DEFAULT_PASSWORD}`);
    expect(file).toContain(`SESSION_SECRET=${env.SESSION_SECRET}`);
    expect(file).toContain(`APP_ENCRYPTION_KEY=${env.APP_ENCRYPTION_KEY}`);
  });

  it("does not rotate valid secrets", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "familyfi-env-"));
    const envPath = path.join(dir, ".env");
    const examplePath = path.join(dir, ".env.example");
    const password = "recovery-pass";
    const session = "abcdefghijklmnopqrstuvwxyz012345";
    const key = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    writeFileSync(examplePath, "DB_PASSWORD=\n");
    writeFileSync(
      envPath,
      `DEFAULT_PASSWORD=${password}\nSESSION_SECRET=${session}\nAPP_ENCRYPTION_KEY=${key}\n`,
    );
    const env: Record<string, string | undefined> = {};
    const result = ensureSecrets({ envPath, examplePath, env });
    expect(result.written).toEqual([]);
    expect(env.DEFAULT_PASSWORD).toBe(password);
    expect(env.SESSION_SECRET).toBe(session);
    expect(env.APP_ENCRYPTION_KEY).toBe(key);
  });

  it("replaces invalid placeholders", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "familyfi-env-"));
    const envPath = path.join(dir, ".env");
    const examplePath = path.join(dir, ".env.example");
    writeFileSync(examplePath, "DB_PASSWORD=\n");
    writeFileSync(envPath, "DEFAULT_PASSWORD=short\nSESSION_SECRET=short\nAPP_ENCRYPTION_KEY=nope\n");
    const env: Record<string, string | undefined> = {};
    const result = ensureSecrets({ envPath, examplePath, env });
    expect(result.written).toEqual(["DEFAULT_PASSWORD", "SESSION_SECRET", "APP_ENCRYPTION_KEY"]);
    expect(isDefaultPasswordValid(env.DEFAULT_PASSWORD)).toBe(true);
    expect(isSessionSecretValid(env.SESSION_SECRET)).toBe(true);
    expect(isEncryptionKeyValid(env.APP_ENCRYPTION_KEY)).toBe(true);
  });
});
