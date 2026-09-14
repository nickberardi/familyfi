#!/usr/bin/env node
import { spawn } from "node:child_process";
import { applyDatabaseUrl } from "./print-database-url.mjs";

applyDatabaseUrl();

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("usage: node scripts/with-env.mjs <command> [...args]");
  process.exit(1);
}

const child = spawn(command, args, { stdio: "inherit", env: process.env, shell: false });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
