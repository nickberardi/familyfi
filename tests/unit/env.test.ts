import { describe, expect, it } from "vitest";
import { ConfigurationError, envIssues, loadEnv } from "@/server/env";

describe("environment validation", () => {
  const valid = {
    DEFAULT_PASSWORD: "recovery-pass",
    SESSION_SECRET: "abcdefghijklmnopqrstuvwxyz012345",
    APP_ENCRYPTION_KEY: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    POSTGRES_PASSWORD: "db-pass",
  };

  it("lists missing secrets without Zod dumps", () => {
    const issues = envIssues({ DEFAULT_PASSWORD: "", SESSION_SECRET: "short", APP_ENCRYPTION_KEY: "x" });
    expect(issues.some((item) => item.includes("DEFAULT_PASSWORD"))).toBe(true);
    expect(issues.some((item) => item.includes("SESSION_SECRET"))).toBe(true);
    expect(issues.some((item) => item.includes("APP_ENCRYPTION_KEY"))).toBe(true);
    expect(issues.join(" ")).not.toMatch(/too_small/i);
  });

  it("throws ConfigurationError for incomplete env", () => {
    expect(() => loadEnv({})).toThrow(ConfigurationError);
  });

  it("accepts a complete env", () => {
    const loaded = loadEnv({ ...valid });
    expect(loaded.DEFAULT_PASSWORD).toBe("recovery-pass");
    expect(loaded.DATABASE_URL).toContain("db-pass");
  });

  it("trims DEFAULT_PASSWORD from the environment", () => {
    const loaded = loadEnv({ ...valid, DEFAULT_PASSWORD: "  recovery-pass  " });
    expect(loaded.DEFAULT_PASSWORD).toBe("recovery-pass");
  });
});
