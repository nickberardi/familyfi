import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const repoRoot = path.resolve(__dirname, "..");
const envPath = path.join(repoRoot, ".env");

if (existsSync(envPath)) {
  for (const raw of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined || process.env[key] === "") process.env[key] = value;
  }
}

const port = process.env.PLAYWRIGHT_PORT || "3100";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./browser",
  outputDir: path.join(repoRoot, "test-results"),
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: process.env.CI
    ? {
        command: `node scripts/with-env.mjs next start --port ${port}`,
        cwd: repoRoot,
        url: `${baseURL}/api/v1/health`,
        reuseExistingServer: false,
        timeout: 180_000,
      }
    : undefined,
});
