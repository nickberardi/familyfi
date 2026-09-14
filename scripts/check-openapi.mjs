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
const HANDLERS = ["get", "post", "put", "patch", "delete"];

function exportedMethods(file) {
  const src = fs.readFileSync(file, "utf8");
  return HANDLERS.filter((method) => new RegExp(`export async function ${method.toUpperCase()}\\b`).test(src));
}

const specPaths = new Set(Object.keys(spec.paths ?? {}));
const implemented = new Map();
function walkWithMethods(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) walkWithMethods(next);
    else if (entry.name === "route.ts") {
      const rel = path.relative(path.join(root, "src/app"), next).replaceAll("\\", "/");
      const apiPath = `/${rel.replace(/\/route\.ts$/, "").replace(/\[([^\]]+)\]/g, "{$1}")}`;
      implemented.set(apiPath, exportedMethods(next));
    }
  }
}
walkWithMethods(apiRoot);

const undocumented = [...implemented.keys()].filter((p) => !specPaths.has(p)).sort();
const extra = [...specPaths].filter((p) => !implemented.has(p)).sort();
if (undocumented.length) {
  console.error(`Implemented routes missing from OpenAPI: ${undocumented.join(", ")}`);
  process.exit(1);
}
if (extra.length) {
  console.error(`OpenAPI paths with no route handler: ${extra.join(", ")}`);
  process.exit(1);
}

const methodDrift = [];
for (const [apiPath, methods] of implemented) {
  const documented = Object.keys(spec.paths[apiPath] ?? {}).filter((key) => HANDLERS.includes(key));
  const missing = methods.filter((method) => !documented.includes(method));
  const unused = documented.filter((method) => !methods.includes(method));
  if (missing.length || unused.length) {
    methodDrift.push(`${apiPath} impl=${methods.join("|") || "∅"} spec=${documented.join("|") || "∅"}`);
  }
}
if (methodDrift.length) {
  console.error(`OpenAPI method drift:\n${methodDrift.join("\n")}`);
  process.exit(1);
}

const missingOpIds = [];
for (const [apiPath, item] of Object.entries(spec.paths ?? {})) {
  for (const method of HANDLERS) {
    const op = item?.[method];
    if (op && !op.operationId) missingOpIds.push(`${method.toUpperCase()} ${apiPath}`);
  }
}
if (missingOpIds.length) {
  console.error(`OpenAPI operations missing operationId: ${missingOpIds.join(", ")}`);
  process.exit(1);
}

const redocly = path.join(root, "node_modules/.bin/redocly");
const result = spawnSync(redocly, ["lint", specPath, "--extends=minimal"], { stdio: "inherit" });
process.exit(result.status ?? 1);
