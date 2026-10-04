import { afterEach, describe, expect, it } from "vitest";
import { DEMO_DATABASE, buildDatabaseUrl } from "@/server/database-url";
import { ConfigurationError, demoModeEnabled, loadEnv, unifiMockEnabled } from "@/server/env";
import { demoLocked, nextDemoResetAt } from "@/server/demo";
import { findCloudflared } from "@/server/tunnel/cloudflared";
import { envIssues as runtimeEnvIssues } from "../../scripts/runtime/env-issues.mjs";
import {
  DEMO_DATABASE as RUNTIME_DEMO_DATABASE,
  buildDatabaseUrl as runtimeDatabaseUrl,
} from "../../scripts/runtime/print-database-url.mjs";

const secrets = {
  FAMILYFI_DEFAULT_PASSWORD: "recovery-pass",
  FAMILYFI_SESSION_SECRET: "abcdefghijklmnopqrstuvwxyz012345",
  FAMILYFI_ENCRYPTION_KEY: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
};
const realDatabase = { DB_MODE: "external", DB_HOST: "db.example", POSTGRES_PORT: "5432", POSTGRES_PASSWORD: "db-pass", DB_SSL_MODE: "require", DB_SSL_ROOT_CERT: "/certs/ca.pem" };
const demoUrl = "postgresql://postgres:postgres@127.0.0.1:5433/template1?sslmode=disable";

describe("demo mode switch", () => {
  it("is off unless FAMILYFI_DEMO is set", () => {
    expect(demoModeEnabled({})).toBe(false);
    expect(demoModeEnabled({ FAMILYFI_DEMO: "0" })).toBe(false);
    expect(demoModeEnabled({ UNIFI_MOCK: "1", NODE_ENV: "production" })).toBe(false);
    expect(demoModeEnabled({ FAMILYFI_DEMO: " yes " })).toBe(true);
  });

  it("turns on the UniFi mock in production, where UNIFI_MOCK alone stays ignored", () => {
    expect(unifiMockEnabled({ NODE_ENV: "production", UNIFI_MOCK: "1" })).toBe(false);
    expect(loadEnv({ ...secrets, POSTGRES_PASSWORD: "db-pass", NODE_ENV: "production", UNIFI_MOCK: "1" })).toMatchObject({ UNIFI_MOCK: false, FAMILYFI_DEMO: false });
    expect(unifiMockEnabled({ NODE_ENV: "production", FAMILYFI_DEMO: "1" })).toBe(true);
    expect(loadEnv({ ...secrets, NODE_ENV: "production", FAMILYFI_DEMO: "1" })).toMatchObject({ UNIFI_MOCK: true, FAMILYFI_DEMO: true });
  });

  it("uses only the in-memory database, whatever database is configured", () => {
    const loaded = loadEnv({ ...secrets, ...realDatabase, NODE_ENV: "production", FAMILYFI_DEMO: "1" });
    expect(loaded.DATABASE_URL).toBe(demoUrl);
    expect(runtimeDatabaseUrl({ ...realDatabase, FAMILYFI_DEMO: "1" })).toBe(demoUrl);
    expect(buildDatabaseUrl(DEMO_DATABASE)).toBe(demoUrl);
    expect(RUNTIME_DEMO_DATABASE).toEqual(DEMO_DATABASE);
    expect(loadEnv({ ...secrets, ...realDatabase }).DATABASE_URL).toContain("db.example");
  });

  it("no longer requires POSTGRES_PASSWORD, and still requires the secrets", () => {
    expect(() => loadEnv({ ...secrets, NODE_ENV: "production" })).toThrow(ConfigurationError);
    expect(runtimeEnvIssues({ ...secrets })).toEqual(["POSTGRES_PASSWORD must be set."]);
    expect(runtimeEnvIssues({ ...secrets, FAMILYFI_DEMO: "1" })).toEqual([]);
    expect(() => loadEnv({ FAMILYFI_DEMO: "1" })).toThrow(ConfigurationError);
    expect(runtimeEnvIssues({ FAMILYFI_DEMO: "1" })).toHaveLength(3);
  });
});

describe("demo mode lock", () => {
  const previous = process.env.FAMILYFI_DEMO;
  afterEach(() => {
    if (previous === undefined) delete process.env.FAMILYFI_DEMO;
    else process.env.FAMILYFI_DEMO = previous;
  });

  it("refuses configuration writes only in demo mode", async () => {
    expect(demoLocked()).toBeNull();
    process.env.FAMILYFI_DEMO = "1";
    const locked = demoLocked();
    expect(locked?.status).toBe(403);
    expect(await locked?.json()).toMatchObject({ error: { code: "demo_locked" } });
  });

  it("never finds cloudflared, so no tunnel opens from the demo host", () => {
    process.env.CLOUDFLARED_BIN = process.execPath; // answers --version, so it would be found
    try {
      expect(findCloudflared()).not.toBeNull();
      process.env.FAMILYFI_DEMO = "1";
      expect(findCloudflared()).toBeNull();
    } finally {
      delete process.env.CLOUDFLARED_BIN;
    }
  });
});

describe("nightly reset", () => {
  it("is the next 03:00 in the household's time zone", () => {
    expect(nextDemoResetAt(new Date("2026-10-04T12:00:00Z"), "America/New_York").toISOString()).toBe("2026-10-05T07:00:00.000Z");
    expect(nextDemoResetAt(new Date("2026-10-04T06:59:00Z"), "America/New_York").toISOString()).toBe("2026-10-04T07:00:00.000Z");
    expect(nextDemoResetAt(new Date("2026-10-04T07:00:00Z"), "America/New_York").toISOString()).toBe("2026-10-05T07:00:00.000Z");
    expect(nextDemoResetAt(new Date("2026-10-04T12:00:00Z"), "Pacific/Kiritimati").toISOString()).toBe("2026-10-04T13:00:00.000Z");
  });
});
