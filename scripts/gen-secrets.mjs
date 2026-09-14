#!/usr/bin/env node
import { generateEncryptionKey, generateSessionSecret } from "./ensure-secrets.mjs";

console.log("# These are generated automatically when missing. Printed here only if you want to copy them elsewhere.");
console.log(`SESSION_SECRET=${generateSessionSecret()}`);
console.log(`APP_ENCRYPTION_KEY=${generateEncryptionKey()}`);
