import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureSecrets,
  isDefaultPasswordValid,
  isEncryptionKeyValid,
} from "../../scripts/runtime/ensure-secrets.mjs";

describe("ensureSecrets", () => {
  it("writes recovery password and crypto secrets when missing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "familyfi-env-"));
    const envPath = path.join(dir, ".env");
    const examplePath = path.join(dir, ".env.example");
    writeFileSync(examplePath, "FAMILYFI_DEFAULT_PASSWORD=\nPOSTGRES_PASSWORD=\n");
    const env: Record<string, string | undefined> = {};
    const result = ensureSecrets({ envPath, examplePath, env });
    expect(result.written).toEqual(["FAMILYFI_DEFAULT_PASSWORD", "FAMILYFI_ENCRYPTION_KEY"]);
    const file = readFileSync(envPath, "utf8");
    expect(isDefaultPasswordValid(env.FAMILYFI_DEFAULT_PASSWORD)).toBe(true);
    expect(isEncryptionKeyValid(env.FAMILYFI_ENCRYPTION_KEY)).toBe(true);
    expect(file).toContain(`FAMILYFI_DEFAULT_PASSWORD=${env.FAMILYFI_DEFAULT_PASSWORD}`);
    // No session secret: nothing uses one.
    expect(file).not.toContain("FAMILYFI_SESSION_SECRET");
    expect(file).toContain(`FAMILYFI_ENCRYPTION_KEY=${env.FAMILYFI_ENCRYPTION_KEY}`);
  });

  it("does not require a .env file when process env already has secrets", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "familyfi-env-"));
    const envPath = path.join(dir, ".env");
    const examplePath = path.join(dir, ".env.example");
    const env: Record<string, string | undefined> = {
      FAMILYFI_DEFAULT_PASSWORD: "recovery-pass",
      FAMILYFI_ENCRYPTION_KEY: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    };
    const result = ensureSecrets({ envPath, examplePath, env });
    expect(result.written).toEqual([]);
    expect(result.created).toEqual([]);
  });

  it("does not rotate valid secrets", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "familyfi-env-"));
    const envPath = path.join(dir, ".env");
    const examplePath = path.join(dir, ".env.example");
    const password = "recovery-pass";
    const key = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    writeFileSync(examplePath, "POSTGRES_PASSWORD=\n");
    writeFileSync(
      envPath,
      `FAMILYFI_DEFAULT_PASSWORD=${password}\nFAMILYFI_ENCRYPTION_KEY=${key}\n`,
    );
    const env: Record<string, string | undefined> = {};
    const result = ensureSecrets({ envPath, examplePath, env });
    expect(result.written).toEqual([]);
    expect(env.FAMILYFI_DEFAULT_PASSWORD).toBe(password);
    expect(env.FAMILYFI_ENCRYPTION_KEY).toBe(key);
  });

  it("replaces invalid placeholders", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "familyfi-env-"));
    const envPath = path.join(dir, ".env");
    const examplePath = path.join(dir, ".env.example");
    writeFileSync(examplePath, "POSTGRES_PASSWORD=\n");
    writeFileSync(envPath, "FAMILYFI_DEFAULT_PASSWORD=short\nFAMILYFI_ENCRYPTION_KEY=nope\n");
    const env: Record<string, string | undefined> = {};
    const result = ensureSecrets({ envPath, examplePath, env });
    expect(result.written).toEqual(["FAMILYFI_DEFAULT_PASSWORD", "FAMILYFI_ENCRYPTION_KEY"]);
    expect(isDefaultPasswordValid(env.FAMILYFI_DEFAULT_PASSWORD)).toBe(true);
    expect(isEncryptionKeyValid(env.FAMILYFI_ENCRYPTION_KEY)).toBe(true);
  });

  it("writes secrets to an explicit envPath (volume-backed path in Docker)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "familyfi-env-"));
    const dataDir = path.join(dir, "var-lib-familyfi-data");
    const envPath = path.join(dataDir, ".env");
    const examplePath = path.join(dir, ".env.example");
    writeFileSync(examplePath, "POSTGRES_PASSWORD=\n");
    const env: Record<string, string | undefined> = {};
    const result = ensureSecrets({ envPath, examplePath, env });
    expect(result.envPath).toBe(envPath);
    expect(result.written).toEqual(["FAMILYFI_DEFAULT_PASSWORD", "FAMILYFI_ENCRYPTION_KEY"]);
    expect(readFileSync(result.envPath, "utf8")).toContain(`FAMILYFI_ENCRYPTION_KEY=${env.FAMILYFI_ENCRYPTION_KEY}`);
  });
});
