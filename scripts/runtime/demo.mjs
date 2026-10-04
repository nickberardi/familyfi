#!/usr/bin/env node
/**
 * Demo mode's launcher (FAMILYFI_DEMO=1, docs/operations.md#demo-mode). It holds the database: an
 * in-memory PGlite served on loopback with DEMO_DATABASE's settings, which lives exactly as long as
 * this process. It applies the migrations, then runs FamilyFi as a child and exits when it does, so
 * every start, including the nightly reset's, begins with an empty database.
 *
 *   node scripts/runtime/demo.mjs --requested   exits 0 when demo mode is requested, 1 when not
 *   node scripts/runtime/demo.mjs <command...>  serves the database and runs the command
 */
import { spawn } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { DEMO_DATABASE, applyDatabaseUrl, demoRequested } from "./print-database-url.mjs";

/** Enough for Prisma's pool (10) beside `prisma migrate deploy`; PGlite runs one query at a time either way. */
const MAX_CONNECTIONS = 20;

/** An empty in-memory database, served until `stop`. Port 0 picks a free port (tests); `port` is the one served. */
export async function startDemoDatabase({ port = Number(DEMO_DATABASE.POSTGRES_PORT) } = {}) {
  const db = await PGlite.create();
  const server = new PGLiteSocketServer({ db, host: DEMO_DATABASE.DB_HOST, port, maxConnections: MAX_CONNECTIONS });
  await server.start();
  return {
    port: Number(server.getServerConn().split(":").pop()),
    async stop() {
      await server.stop();
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
  if (argv[0] === "--requested") process.exit(demoRequested() ? 0 : 1);
  if (!demoRequested()) {
    console.error("demo.mjs runs only with FAMILYFI_DEMO=1.");
    process.exit(1);
  }
  const [command, ...args] = argv;
  if (!command) {
    console.error("usage: node scripts/runtime/demo.mjs <command> [...args]");
    process.exit(1);
  }

  const database = await startDemoDatabase();
  console.log("demo mode: in-memory database started; nothing is kept between starts");
  const migrated = await run("./node_modules/.bin/prisma", ["migrate", "deploy"]);
  if (migrated !== 0) {
    await database.stop();
    process.exit(migrated);
  }

  const child = spawn(command, args, { stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("exit", async (code, signal) => {
    await database.stop();
    process.exit(signal ? 1 : (code ?? 1));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
