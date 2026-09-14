#!/usr/bin/env node
/**
 * Phase 1 UniFi spike CLI.
 * Does not store credentials in the application database.
 * Temporary UNIFI_API_KEY is accepted for this CLI only.
 */
const key = process.env.UNIFI_API_KEY;
const base = process.env.UNIFI_BASE_URL;
const consoleId = process.env.UNIFI_CONSOLE_ID;

console.log("FamilyFi UniFi spike");
console.log("This live gate is Phase 1. Official MAC block/restore must be proven");
console.log("against a real gateway before enforcement-dependent backend work.");
console.log("");
if (!key || !(base || consoleId)) {
  console.log("Set UNIFI_API_KEY and either UNIFI_BASE_URL (local integration base)");
  console.log("or UNIFI_CONSOLE_ID (cloud connector). Never commit keys or unsanitized responses.");
  process.exit(2);
}

console.log("Credentials are present, but the live probe is not implemented yet.");
process.exit(2);
