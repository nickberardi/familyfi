import { spawn } from "node:child_process";
import { env, inMemoryDatabase } from "./env";

/** What `pg_dump` made, or why there is no dump: the export still carries the configuration without it. */
export type DatabaseDump = { data: Buffer } | { data: null; reason: string };

let testDump: (() => Promise<DatabaseDump>) | undefined;

/** Integration tests stand in for `pg_dump`, whose version on a test host need not match the server's. */
export function setDatabaseDumpForTests(dump?: () => Promise<DatabaseDump>) {
  testDump = dump;
}

/** The same cap the import reader applies to each file. */
export const DATABASE_DUMP_MAX_BYTES = 50 * 1024 * 1024;
/** A dump waiting on a lock, or on a database that stopped answering, gives up rather than hold the export. */
const DUMP_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * A `pg_dump --format=custom` of the household database, for an exact restore with `pg_restore`.
 * The release image carries the PostgreSQL 18 client (docker/Dockerfile); elsewhere `pg_dump` may be
 * missing or older than the server, which is reported rather than failing the export. The in-memory
 * database is never dumped: it is gone after a restart anyway.
 */
export function dumpDatabase(command = "pg_dump", timeoutMs = DUMP_TIMEOUT_MS): Promise<DatabaseDump> {
  if (testDump) return testDump();
  if (inMemoryDatabase()) return Promise.resolve({ data: null, reason: "The database is in memory, so there is nothing to dump." });
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = "";
    let settled = false;
    const finish = (dump: DatabaseDump) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(dump);
    };
    // The password goes in the environment, not the command line any process can list.
    const url = new URL(env().DATABASE_URL);
    const password = decodeURIComponent(url.password);
    url.password = "";
    const child = spawn(command, ["--format=custom", "--no-owner", "--dbname", url.toString()], {
      env: { ...process.env, PGPASSWORD: password },
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Every event that settles the dump comes after this line runs, so `finish` always sees it.
    const timeout = setTimeout(() => {
      child.kill();
      finish({ data: null, reason: `pg_dump did not finish within ${Math.round(timeoutMs / 60_000)} minutes.` });
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > DATABASE_DUMP_MAX_BYTES) {
        child.kill();
        finish({ data: null, reason: "The database dump is larger than 50 MB." });
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-2_000);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish({ data: null, reason: error.code === "ENOENT" ? "pg_dump is not installed here." : `pg_dump did not start: ${error.message}` });
    });
    child.on("close", (code) => {
      if (code === 0) finish({ data: Buffer.concat(chunks) });
      else finish({ data: null, reason: `pg_dump failed: ${stderr.trim() || `exit ${code}`}` });
    });
  });
}
