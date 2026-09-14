#!/usr/bin/env node
import { spawn } from "node:child_process";
import { applyDatabaseUrl } from "./print-database-url.mjs";
import { ensureSecrets } from "./ensure-secrets.mjs";
import { assertEnv } from "./env-issues.mjs";
import { prepareDatabase, shouldPrepareDatabase } from "./prepare-database.mjs";

applyDatabaseUrl();
const result = ensureSecrets();
if (result.written.length) {
  console.log(`generated ${result.written.join(" and ")} in ${result.envPath}`);
}
assertEnv();

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("usage: node scripts/with-env.mjs <command> [...args]");
  process.exit(1);
}

if (shouldPrepareDatabase(command, args)) {
  try {
    prepareDatabase();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

const childEnv = { ...process.env };
const isSpike = args.some((arg) => String(arg).includes("scripts/spike/"));
const tlsInsecure = ["1", "true", "yes"].includes((process.env.UNIFI_TLS_INSECURE ?? "").trim().toLowerCase());
if (isSpike && tlsInsecure) {
  childEnv.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const child = spawn(command, args, { stdio: "inherit", env: childEnv, shell: false });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
