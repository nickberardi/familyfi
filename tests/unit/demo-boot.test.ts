import { spawn } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureHousehold, ensureRecoveryAccount } from "@/server/auth";
import { disconnectPrismaForTests, prisma } from "@/server/db";
import { ensureDemoRoute, startDemoReset } from "@/server/demo";
import { ensureDevDummyData } from "@/server/dev-seed";
import { resetEnvCacheForTests } from "@/server/env";
import { ensureUpstreamCategories } from "@/server/upstream-seed";
import { startMemoryDatabase } from "../../scripts/runtime/memory-database.mjs";

/**
 * Demo mode's boot on the in-memory database `scripts/runtime/memory-database.mjs` serves: the unchanged
 * migrations apply to PGlite, and the boot seed fills the household. On a free port rather than
 * the demo's own, so runs on one machine never collide; the URL shape is `familyfi-mode.test.ts`'s.
 */
const root = path.resolve(__dirname, "../..");
let database: { port: number; stop: () => Promise<void> };

function migrate(env: NodeJS.ProcessEnv): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(root, "node_modules/.bin/prisma"), ["migrate", "deploy"], { cwd: root, env, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", resolve);
  });
}

beforeAll(async () => {
  database = await startMemoryDatabase({ port: 0 });
  Object.assign(process.env, {
    FAMILYFI_DEFAULT_PASSWORD: "recovery-pass",
    FAMILYFI_SESSION_SECRET: "abcdefghijklmnopqrstuvwxyz012345",
    FAMILYFI_ENCRYPTION_KEY: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    DB_HOST: "127.0.0.1",
    POSTGRES_PORT: String(database.port),
    POSTGRES_DB: "template1",
    POSTGRES_USER: "postgres",
    POSTGRES_PASSWORD: "postgres",
    DB_SSL_MODE: "disable",
    FAMILYFI_MODE: "test",
  });
  delete process.env.DATABASE_URL;
  delete process.env.DB_SSL_ROOT_CERT;
  resetEnvCacheForTests();
  expect(await migrate(process.env)).toBe(0);
}, 120_000);

afterAll(async () => {
  await disconnectPrismaForTests();
  await database?.stop();
});

describe("demo mode boot on PGlite", () => {
  it("applies every migration and seeds the household", async () => {
    await ensureRecoveryAccount();
    await ensureHousehold();
    await ensureUpstreamCategories();
    await ensureDevDummyData();
    const [admin, groups, devices, categories] = await Promise.all([
      prisma().account.findUnique({ where: { username: "admin" } }),
      prisma().group.count(),
      prisma().device.count(),
      prisma().upstreamCategory.count(),
    ]);
    expect(admin?.isAdmin).toBe(true);
    expect(groups).toBeGreaterThan(0);
    expect(devices).toBeGreaterThan(0);
    expect(categories).toBeGreaterThan(0);
  }, 60_000);

  it("publishes the demo address as the household's remote route, once", async () => {
    await ensureDemoRoute("https://demo.familyfi.test");
    await ensureDemoRoute("https://demo.familyfi.test");
    const routes = await prisma().connectionEndpoint.findMany();
    expect(routes).toEqual([expect.objectContaining({ url: "https://demo.familyfi.test", kind: "own", transport: "lan", trustMode: "system", enabled: true, edgeAuth: "none" })]);
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    expect(household.remoteEndpointId).toBe(routes[0].id);
    await expect(ensureDemoRoute("http://demo.familyfi.test")).rejects.toThrow(/HTTPS/);
    await ensureDemoRoute("");
    expect(await prisma().connectionEndpoint.count()).toBe(1);
  });

  it("exits at the household's next 03:00", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const exit = vi.fn();
      const at = await startDemoReset(new Date("2026-10-04T12:00:00Z"), exit);
      expect(at.toISOString()).toBe("2026-10-05T07:00:00.000Z");
      vi.advanceTimersByTime(at.getTime() - Date.parse("2026-10-04T12:00:00Z") - 1);
      expect(exit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(exit).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
