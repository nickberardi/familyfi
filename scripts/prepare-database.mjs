import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyDatabaseUrl } from "./print-database-url.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function truthy(value) {
  return ["1", "true", "yes"].includes(String(value ?? "").trim().toLowerCase());
}

export function shouldPrepareDatabase(command, args = []) {
  if (truthy(process.env.SKIP_DB_PREPARE)) return false;
  const hay = [command, ...args].join(" ");
  if (hay.includes("scripts/spike")) return false;
  if (hay.includes("node_modules/.bin/prisma") || /(^|\s)prisma(\s|$)/.test(hay)) return false;
  return true;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runPrisma(args) {
  const bin = path.join(root, "node_modules/.bin/prisma");
  const result = spawnSync(bin, args, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(detail || `prisma ${args.join(" ")} failed`);
  }
  return result;
}

export function prepareDatabase(options = {}) {
  const attempts = options.attempts ?? 30;
  const generate = options.generate ?? process.env.NODE_ENV !== "production";
  applyDatabaseUrl();

  let reachable = false;
  for (let i = 0; i < attempts; i++) {
    const ping = spawnSync(process.execPath, [path.join(root, "scripts/wait-for-db.mjs")], {
      env: process.env,
      encoding: "utf8",
    });
    if (ping.status === 0) {
      reachable = true;
      break;
    }
    if (i === 0) console.error("waiting for PostgreSQL…");
    sleep(2000);
  }
  if (!reachable) {
    throw new Error("PostgreSQL was not reachable. Run make setup, or start Postgres and set DB_HOST.");
  }

  runPrisma(["migrate", "deploy"]);
  if (generate) runPrisma(["generate"]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    prepareDatabase();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
