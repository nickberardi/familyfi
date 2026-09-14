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
];
const missing = required.filter((p) => !spec.paths?.[p]);
if (missing.length) {
  console.error(`OpenAPI missing paths: ${missing.join(", ")}`);
  process.exit(1);
}

const redocly = path.join(root, "node_modules/.bin/redocly");
const result = spawnSync(redocly, ["lint", specPath, "--extends=minimal"], { stdio: "inherit" });
process.exit(result.status ?? 1);
