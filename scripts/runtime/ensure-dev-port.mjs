#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline/promises";

const port = Number(process.argv[2] || process.env.PORT || "3000");

function listeners(listenPort) {
  let output = "";
  try {
    output = execFileSync("lsof", ["-nP", `-iTCP:${listenPort}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return [];
  }
  const rows = [];
  for (const line of output.split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const pid = Number(parts[1]);
    if (Number.isInteger(pid) && pid > 0) rows.push({ command: parts[0], pid });
  }
  return [...new Map(rows.map((row) => [row.pid, row])).values()];
}

function stillListening() {
  return listeners(port).length > 0;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function confirm(question) {
  const auto = process.env.KILL_PORT;
  if (auto === "1" || auto === "true") return true;
  if (auto === "0" || auto === "false") return false;
  if (!fs.existsSync("/dev/tty")) return false;
  const input = fs.createReadStream("/dev/tty");
  const rl = readline.createInterface({ input, output: process.stderr, terminal: true });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } catch {
    return false;
  } finally {
    rl.close();
    input.destroy();
  }
}

const held = listeners(port);
if (!held.length) process.exit(0);

const who = held.map((row) => `${row.command} pid ${row.pid}`).join(", ");
const ok = await confirm(`Port ${port} is in use (${who}). Kill it and continue? [y/N] `);
if (!ok) {
  console.error(`Port ${port} is still in use (${who}).`);
  process.exit(1);
}

for (const row of held) {
  try {
    process.kill(row.pid, "SIGTERM");
  } catch {
    // already gone
  }
}
const termDeadline = Date.now() + 2000;
while (Date.now() < termDeadline && stillListening()) await sleep(100);
if (stillListening()) {
  for (const row of listeners(port)) {
    try {
      process.kill(row.pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  const killDeadline = Date.now() + 1000;
  while (Date.now() < killDeadline && stillListening()) await sleep(100);
}
if (stillListening()) {
  console.error(`Could not free port ${port}.`);
  process.exit(1);
}
console.error(`Freed port ${port}.`);
