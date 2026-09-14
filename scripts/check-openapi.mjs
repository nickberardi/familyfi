#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import YAML from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const specPath = path.join(root, "openapi/familyfi.v1.yaml");

if (!fs.existsSync(specPath)) {
  console.error("missing openapi/familyfi.v1.yaml");
  process.exit(1);
}

const spec = YAML.parse(fs.readFileSync(specPath, "utf8"));
const required = [
  "/api/v1/health",
  "/api/v1/auth/login",
  "/api/v1/auth/logout",
  "/api/v1/auth/session",
  "/api/v1/accounts",
  "/api/v1/settings/household",
  "/api/v1/settings/unifi",
  "/api/v1/groups",
  "/api/v1/devices",
  "/api/v1/sync",
];
const missing = required.filter((p) => !spec.paths?.[p]);
if (missing.length) {
  console.error(`OpenAPI missing paths: ${missing.join(", ")}`);
  process.exit(1);
}

const apiRoot = path.join(root, "src/app/api");
const implemented = new Set();
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(next);
    else if (entry.name === "route.ts") {
      const rel = path.relative(path.join(root, "src/app"), next).replaceAll("\\", "/");
      implemented.add(`/${rel.replace(/\/route\.ts$/, "").replace(/\[([^\]]+)\]/g, "{$1}")}`);
    }
  }
}
walk(apiRoot);
const specPaths = new Set(Object.keys(spec.paths ?? {}));
const undocumented = [...implemented].filter((p) => !specPaths.has(p)).sort();
const extra = [...specPaths].filter((p) => !implemented.has(p)).sort();
if (undocumented.length) {
  console.error(`Implemented routes missing from OpenAPI: ${undocumented.join(", ")}`);
  process.exit(1);
}
if (extra.length) {
  console.error(`OpenAPI paths with no route handler: ${extra.join(", ")}`);
  process.exit(1);
}

const redocly = path.join(root, "node_modules/.bin/redocly");
const result = spawnSync(redocly, ["lint", specPath, "--extends=minimal"], { stdio: "inherit" });
process.exit(result.status ?? 1);
