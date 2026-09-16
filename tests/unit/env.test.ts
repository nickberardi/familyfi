import { describe, expect, it } from "vitest";
import { ConfigurationError, envIssues, loadEnv } from "@/server/env";

describe("environment validation", () => {
  const valid = {
    FAMILYFI_DEFAULT_PASSWORD: "recovery-pass",
    FAMILYFI_SESSION_SECRET: "abcdefghijklmnopqrstuvwxyz012345",
    FAMILYFI_ENCRYPTION_KEY: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    POSTGRES_PASSWORD: "db-pass",
  };

  it("lists missing secrets without Zod dumps", () => {
    const issues = envIssues({ FAMILYFI_DEFAULT_PASSWORD: "", FAMILYFI_SESSION_SECRET: "short", FAMILYFI_ENCRYPTION_KEY: "x" });
    expect(issues.some((item) => item.includes("FAMILYFI_DEFAULT_PASSWORD"))).toBe(true);
    expect(issues.some((item) => item.includes("FAMILYFI_SESSION_SECRET"))).toBe(true);
    expect(issues.some((item) => item.includes("FAMILYFI_ENCRYPTION_KEY"))).toBe(true);
    expect(issues.join(" ")).not.toMatch(/too_small/i);
  });

  it("throws ConfigurationError for incomplete env", () => {
    expect(() => loadEnv({})).toThrow(ConfigurationError);
  });

  it("accepts a complete env", () => {
    const loaded = loadEnv({ ...valid });
    expect(loaded.FAMILYFI_DEFAULT_PASSWORD).toBe("recovery-pass");
    expect(loaded.DATABASE_URL).toContain("db-pass");
  });

  it("trims FAMILYFI_DEFAULT_PASSWORD from the environment", () => {
    const loaded = loadEnv({ ...valid, FAMILYFI_DEFAULT_PASSWORD: "  recovery-pass  " });
    expect(loaded.FAMILYFI_DEFAULT_PASSWORD).toBe("recovery-pass");
  });
});
