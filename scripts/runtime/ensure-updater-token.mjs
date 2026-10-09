#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The token FamilyFi and its Watchtower sidecar share (docker/docker-compose.yml): written once
 * into the updater volume, which the app mounts read-write and Watchtower read-only, and never
 * rewritten. The entrypoint runs this as root before FamilyFi or Watchtower starts, because
 * Watchtower takes a token path it cannot open as the token itself.
 */
export const UPDATER_TOKEN_DIR = "/var/lib/familyfi/updater";

/** Returns true when it wrote a new token, false when one was there or the volume is missing. */
export function ensureUpdaterToken(dir = UPDATER_TOKEN_DIR) {
  if (!fs.existsSync(dir)) return false;
  const file = path.join(dir, "token");
  try {
    if (fs.readFileSync(file, "utf8").trim()) return false;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temporary = `${file}.${process.pid}`;
  fs.writeFileSync(temporary, `${randomBytes(32).toString("hex")}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (ensureUpdaterToken(process.argv[2])) console.log("Generated the updater token.");
}
