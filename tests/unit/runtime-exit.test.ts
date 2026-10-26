import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { exitCode } from "../../scripts/runtime/exit-code.mjs";

const repoRoot = path.resolve(__dirname, "../..");
const withEnv = path.join(repoRoot, "scripts/runtime/with-env.mjs");

/** Settings complete enough that with-env writes nothing and prepares no database. */
const env: NodeJS.ProcessEnv = {
  PATH: process.env.PATH ?? "",
  NODE_ENV: "development",
  FAMILYFI_MODE: "dev",
  DB_MODE: "external",
  DB_HOST: "127.0.0.1",
  POSTGRES_PASSWORD: "db-pass",
  SKIP_DB_PREPARE: "1",
  FAMILYFI_DEFAULT_PASSWORD: "recovery-pass",
  FAMILYFI_ENCRYPTION_KEY: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
};

describe("startup launchers' exit code", () => {
  it("passes on a child's code, and a signal as 128 + its number", () => {
    expect(exitCode(0, null)).toBe(0);
    expect(exitCode(3, null)).toBe(3);
    expect(exitCode(null, null)).toBe(1);
    expect(exitCode(null, "SIGTERM")).toBe(143);
    expect(exitCode(null, "SIGINT")).toBe(130);
  });

  it("exits with-env as its command did", () => {
    const ok = spawnSync(process.execPath, [withEnv, process.execPath, "-e", "process.exit(7)"], { cwd: repoRoot, env, encoding: "utf8" });
    expect(ok.status).toBe(7);
    const killed = spawnSync(process.execPath, [withEnv, process.execPath, "-e", "process.kill(process.pid, 'SIGTERM')"], { cwd: repoRoot, env, encoding: "utf8" });
    expect(killed.status).toBe(143);
  });

  it("reads a stop as the server's own SIGTERM exit, never 1", async () => {
    const child = spawn(process.execPath, [withEnv, process.execPath, "-e", "console.log('up'); setInterval(() => {}, 1000)"], { cwd: repoRoot, env, stdio: ["ignore", "pipe", "inherit"] });
    await new Promise<void>((resolve) => child.stdout.once("data", () => resolve()));
    const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
    child.kill("SIGTERM");
    expect(await exited).toBe(143);
  });
});
