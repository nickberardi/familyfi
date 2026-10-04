import { afterEach, describe, expect, it } from "vitest";
import { buildDatabaseUrl, memoryDatabase } from "@/server/database-url";
import {
  ConfigurationError,
  demoModeEnabled,
  envIssues,
  familyfiMode,
  inMemoryDatabase,
  legacyUnifiMock,
  loadEnv,
  modeIssues,
  unifiMockEnabled,
} from "@/server/env";
import { demoLocked, nextDemoResetAt } from "@/server/demo";
import { findCloudflared } from "@/server/tunnel/cloudflared";
import { envIssues as runtimeEnvIssues } from "../../scripts/runtime/env-issues.mjs";
import * as runtime from "../../scripts/runtime/mode.mjs";
import { buildDatabaseUrl as runtimeDatabaseUrl } from "../../scripts/runtime/print-database-url.mjs";

const secrets = {
  FAMILYFI_DEFAULT_PASSWORD: "recovery-pass",
  FAMILYFI_SESSION_SECRET: "abcdefghijklmnopqrstuvwxyz012345",
  FAMILYFI_ENCRYPTION_KEY: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
};
const realDatabase = { DB_MODE: "external", DB_HOST: "db.example", POSTGRES_PORT: "5432", POSTGRES_PASSWORD: "db-pass", DB_SSL_MODE: "require", DB_SSL_ROOT_CERT: "/certs/ca.pem" };
const memoryUrl = (port = "5433") => `postgresql://postgres:postgres@127.0.0.1:${port}/template1?sslmode=disable`;

/** Every combination the mode reads, so the TypeScript and the startup scripts' copy stay equal. */
const CASES: Record<string, string | undefined>[] = [];
for (const NODE_ENV of [undefined, "development", "test", "production"])
  for (const FAMILYFI_MODE of [undefined, "dev", "test", "demo", "prod", " Demo ", "staging"])
    for (const UNIFI_MOCK of [undefined, "1"])
      for (const CI of [undefined, "1"])
        for (const DB_MODE of [undefined, "external", "memory"]) CASES.push({ NODE_ENV, FAMILYFI_MODE, UNIFI_MOCK, CI, DB_MODE });

describe("FAMILYFI_MODE", () => {
  it("defaults to prod, a real gateway on PostgreSQL", () => {
    expect(familyfiMode({})).toBe("prod");
    expect(unifiMockEnabled({})).toBe(false);
    expect(inMemoryDatabase({})).toBe(false);
    expect(loadEnv({ ...secrets, ...realDatabase })).toMatchObject({ FAMILYFI_MODE: "prod", UNIFI_MOCK: false });
  });

  it("runs the UniFi mock in dev, test and demo", () => {
    for (const mode of ["dev", "test", "demo"]) {
      expect(familyfiMode({ FAMILYFI_MODE: mode })).toBe(mode);
      expect(unifiMockEnabled({ FAMILYFI_MODE: mode })).toBe(true);
    }
    expect(familyfiMode({ FAMILYFI_MODE: " Demo " })).toBe("demo");
    expect(demoModeEnabled({ FAMILYFI_MODE: "demo" })).toBe(true);
    expect(demoModeEnabled({ FAMILYFI_MODE: "dev" })).toBe(false);
  });

  it("starts only prod and demo in production, and test under CI", () => {
    const production = { ...secrets, ...realDatabase, NODE_ENV: "production" };
    expect(() => loadEnv({ ...production, FAMILYFI_MODE: "dev" })).toThrow(/FAMILYFI_MODE=dev is not allowed in production/);
    expect(() => loadEnv({ ...production, FAMILYFI_MODE: "test" })).toThrow(/only under CI/);
    expect(loadEnv({ ...production, FAMILYFI_MODE: "test", CI: "1" })).toMatchObject({ FAMILYFI_MODE: "test", UNIFI_MOCK: true });
    expect(loadEnv({ ...production, FAMILYFI_MODE: "demo" })).toMatchObject({ FAMILYFI_MODE: "demo", UNIFI_MOCK: true });
    // A refused mode never runs the mock, even before startup reports it.
    expect(familyfiMode({ NODE_ENV: "production", FAMILYFI_MODE: "dev" })).toBe("prod");
    expect(() => loadEnv({ ...secrets, ...realDatabase, FAMILYFI_MODE: "staging" })).toThrow(/must be dev, test, demo or prod/);
  });

  it("reads UNIFI_MOCK as the deprecated name for dev, never in production", () => {
    expect(familyfiMode({ UNIFI_MOCK: "1" })).toBe("dev");
    expect(familyfiMode({ NODE_ENV: "test", UNIFI_MOCK: "true" })).toBe("dev");
    expect(familyfiMode({ NODE_ENV: "production", UNIFI_MOCK: "1" })).toBe("prod");
    expect(familyfiMode({ NODE_ENV: "production", CI: "1", UNIFI_MOCK: "1" })).toBe("prod");
    expect(familyfiMode({ FAMILYFI_MODE: "prod", UNIFI_MOCK: "1" })).toBe("prod");
    expect(legacyUnifiMock({ UNIFI_MOCK: "1" })).toBe(true);
    expect(legacyUnifiMock({ FAMILYFI_MODE: "dev", UNIFI_MOCK: "1" })).toBe(false);
  });

  it("puts demo on the in-memory database, whatever database is configured", () => {
    const loaded = loadEnv({ ...secrets, ...realDatabase, NODE_ENV: "production", FAMILYFI_MODE: "demo" });
    expect(loaded.DATABASE_URL).toBe(memoryUrl("5432"));
    expect(loaded.DB_MODE).toBe("memory");
    expect(loadEnv({ ...secrets, NODE_ENV: "production", FAMILYFI_MODE: "demo" }).DATABASE_URL).toBe(memoryUrl());
    expect(runtimeDatabaseUrl({ ...realDatabase, FAMILYFI_MODE: "demo" })).toBe(memoryUrl("5432"));
    expect(buildDatabaseUrl(memoryDatabase())).toBe(memoryUrl());
  });

  it("puts dev and test in memory only with DB_MODE=memory, and never prod", () => {
    expect(inMemoryDatabase({ FAMILYFI_MODE: "dev" })).toBe(false);
    expect(inMemoryDatabase({ FAMILYFI_MODE: "dev", DB_MODE: "memory" })).toBe(true);
    expect(inMemoryDatabase({ FAMILYFI_MODE: "test", DB_MODE: "memory" })).toBe(true);
    expect(inMemoryDatabase({ DB_MODE: "memory" })).toBe(false);
    expect(modeIssues({ DB_MODE: "memory" })).toEqual(["DB_MODE=memory is for dev, test and demo; prod keeps its household in PostgreSQL."]);
    expect(loadEnv({ ...secrets, FAMILYFI_MODE: "dev", DB_MODE: "memory", POSTGRES_PORT: "41234" }).DATABASE_URL).toBe(memoryUrl("41234"));
  });

  it("needs no POSTGRES_PASSWORD in memory, and still needs the secrets", () => {
    expect(() => loadEnv({ ...secrets, NODE_ENV: "production" })).toThrow(ConfigurationError);
    expect(runtimeEnvIssues({ ...secrets })).toEqual(["POSTGRES_PASSWORD must be set."]);
    expect(runtimeEnvIssues({ ...secrets, FAMILYFI_MODE: "demo" })).toEqual([]);
    expect(runtimeEnvIssues({ ...secrets, FAMILYFI_MODE: "dev", DB_MODE: "memory" })).toEqual([]);
    expect(() => loadEnv({ FAMILYFI_MODE: "demo" })).toThrow(ConfigurationError);
    expect(runtimeEnvIssues({ FAMILYFI_MODE: "demo" })).toHaveLength(3);
  });

  it("reads the same in the startup scripts as in the app", () => {
    expect(runtime.FAMILYFI_MODES).toEqual(["dev", "test", "demo", "prod"]);
    expect(runtime.memoryDatabase("41234")).toEqual(memoryDatabase("41234"));
    for (const source of CASES) {
      expect(runtime.familyfiMode(source), JSON.stringify(source)).toBe(familyfiMode(source));
      expect(runtime.modeIssues(source), JSON.stringify(source)).toEqual(modeIssues(source));
      expect(runtime.inMemoryDatabase(source), JSON.stringify(source)).toBe(inMemoryDatabase(source));
      const full = { ...secrets, POSTGRES_PASSWORD: "db-pass", ...source };
      expect(runtimeEnvIssues(full), JSON.stringify(source)).toEqual(envIssues(full));
    }
  });
});

describe("demo mode lock", () => {
  const previous = process.env.FAMILYFI_MODE;
  afterEach(() => {
    if (previous === undefined) delete process.env.FAMILYFI_MODE;
    else process.env.FAMILYFI_MODE = previous;
  });

  it("refuses configuration writes only in demo mode", async () => {
    expect(demoLocked()).toBeNull();
    process.env.FAMILYFI_MODE = "dev";
    expect(demoLocked()).toBeNull();
    process.env.FAMILYFI_MODE = "demo";
    const locked = demoLocked();
    expect(locked?.status).toBe(403);
    expect(await locked?.json()).toMatchObject({ error: { code: "demo_locked" } });
  });

  it("never finds cloudflared, so no tunnel opens from the demo host", () => {
    process.env.CLOUDFLARED_BIN = process.execPath; // answers --version, so it would be found
    try {
      expect(findCloudflared()).not.toBeNull();
      process.env.FAMILYFI_MODE = "demo";
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
