#!/usr/bin/env node
// Runs the prototype against PGlite, the in-memory database tests and the demo use (issue 374, step 2b).
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Async: the database is served from this process, so a blocking child would starve it.
const run = async (cmd, args, opts) => {
  const { stdout, stderr } = await promisify(execFile)(cmd, args, { ...opts, maxBuffer: 1 << 24 }).catch((e) => e);
  process.stdout.write(stdout ?? "");
  process.stderr.write(stderr ?? "");
};
import { startMemoryDatabase } from "../../scripts/runtime/memory-database.mjs";

const port = 55441;
const database = await startMemoryDatabase({ port });
const env = { ...process.env, PGPORT: String(port), PGHOST: "127.0.0.1", PGPASSWORD: "x" };
try {
  const url = (user) => `postgresql://${user}:x@127.0.0.1:${port}/postgres`;
  await run("pnpm", ["exec", "prisma", "migrate", "deploy"], { env: { ...env, DATABASE_URL: url("postgres"), DB_HOST: "127.0.0.1", POSTGRES_PORT: String(port), POSTGRES_USER: "postgres", POSTGRES_PASSWORD: "x", POSTGRES_DB: "postgres" } });
  await run("psql", ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-1", "-qf", "prototypes/rls/setup.sql"], { env });
  await run("node", ["prototypes/rls/prototype.ts"], {
    env: { ...env, OWNER_URL: url("postgres"), APP_URL: url("familyfi_app"), SET_ROLE: "1" },
  });
} finally {
  await database.stop();
}
