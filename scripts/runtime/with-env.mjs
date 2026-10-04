#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inMemoryDatabase } from "./mode.mjs";
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
  console.error("usage: node scripts/runtime/with-env.mjs <command> [...args]");
  process.exit(1);
}

/** Runs `command` and exits as it does. A stop (SIGTERM) reaches it too, as it does under the in-memory launcher. */
function exec(command, args, env = process.env) {
  const child = spawn(command, args, { stdio: "inherit", env, shell: false });
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}

if (inMemoryDatabase() && !process.env.FAMILYFI_DATABASE_SERVED) {
  // The in-memory database lives in its launcher's process, so this command runs again under it.
  const launcher = fileURLToPath(new URL("./memory-database.mjs", import.meta.url));
  exec(process.execPath, [launcher, process.execPath, fileURLToPath(import.meta.url), command, ...args]);
} else {
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
  const tlsInsecure = ["1", "true", "yes"].includes((process.env.SPIKE_TLS_INSECURE ?? "").trim().toLowerCase());
  if (isSpike && tlsInsecure) {
    childEnv.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
  exec(command, args, childEnv);
}
