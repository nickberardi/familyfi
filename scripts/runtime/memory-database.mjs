#!/usr/bin/env node
/**
 * The in-memory database's launcher: demo (`FAMILYFI_MODE=demo`, docs/operations.md#demo-mode), and
 * dev or test with `DB_SERVER=memory`. It holds the database, an in-memory PGlite served on loopback
 * with `memoryDatabase`'s settings (mode.mjs), which lives exactly as long as this process.
 *
 *   node scripts/runtime/memory-database.mjs --requested   exits 0 when the in-memory database is in use, 1 when not
 *   node scripts/runtime/memory-database.mjs --serve       serves an empty database until stopped (scripts/test.py)
 *   node scripts/runtime/memory-database.mjs <command...>  serves it, applies the migrations, and runs the command,
 *                                                          exiting when it does: every start begins empty
 */
import { spawn } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { inMemoryDatabase, memoryDatabase, setting } from "./mode.mjs";
import { applyDatabaseUrl } from "./print-database-url.mjs";
import { servePGlite } from "./pglite-server.mjs";

/** Set for the command this launcher runs, so with-env.mjs does not start a second database. */
export const SERVED = "FAMILYFI_DATABASE_SERVED";

/** An empty in-memory database, served until `stop`. Port 0 picks a free port (tests); `port` is the one served. */
export async function startMemoryDatabase({ port = Number(memoryDatabase().DB_PORT) } = {}) {
  const db = await PGlite.create();
  const server = await servePGlite(db, { host: memoryDatabase().DB_HOST, port });
  return {
    port: server.port,
    async stop() {
      await server.close();
      await db.close();
    },
  };
}

/** Runs a command to completion, resolving with its exit code. Async, so this process keeps serving the database. */
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
}

async function main(argv) {
  applyDatabaseUrl();
  if (argv[0] === "--requested") process.exit(inMemoryDatabase() ? 0 : 1);
  if (!inMemoryDatabase()) {
    console.error("memory-database.mjs runs only with FAMILYFI_MODE=demo, or dev or test with DB_SERVER=memory.");
    process.exit(1);
  }
  const port = Number(memoryDatabase(setting(process.env, "DB_PORT")).DB_PORT);
  const database = await startMemoryDatabase({ port });
  const stop = async (code) => {
    await database.stop();
    process.exit(code);
  };

  if (argv[0] === "--serve") {
    console.log(`in-memory database: serving on 127.0.0.1:${database.port}`);
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => void stop(0));
    return;
  }

  const [command, ...args] = argv;
  if (!command) {
    console.error("usage: node scripts/runtime/memory-database.mjs --requested | --serve | <command> [...args]");
    await stop(1);
  }
  console.log("in-memory database: started; nothing is kept between starts");
  process.env[SERVED] = "1";
  process.env.SKIP_DB_PREPARE = "1";
  const migrated = await run("./node_modules/.bin/prisma", ["migrate", "deploy"]);
  if (migrated !== 0) await stop(migrated);

  const child = spawn(command, args, { stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("exit", (code, signal) => void stop(signal ? 1 : (code ?? 1)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
