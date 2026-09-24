import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { CI_EXCLUDED_TAGS } from "./browser-ci-guard";

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

const ci = Boolean(process.env.CI);
if (ci && !process.env.FAMILYFI_DEFAULT_PASSWORD) {
  throw new Error("FAMILYFI_DEFAULT_PASSWORD must be set in CI; without it every browser test skips.");
}
// Tags are matched whole, so `@phone` never catches a longer tag that starts the same way.
const tagPattern = (tag: string) => new RegExp(`${tag}(?![\\w-])`);
const ciExcluded = ci ? Object.keys(CI_EXCLUDED_TAGS).map(tagPattern) : [];

const port = process.env.PLAYWRIGHT_PORT || "3100";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./browser",
  outputDir: path.join(repoRoot, "test-results"),
  fullyParallel: false,
  forbidOnly: ci,
  // One retry records a trace (`on-first-retry`); a test that needed it is a flake and
  // fails the run rather than passing quietly.
  retries: ci ? 1 : 0,
  failOnFlakyTests: ci,
  reporter: ci ? [["dot"], ["./browser-ci-guard.ts"]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    // A test tagged for one viewport never runs in the other, so it needs no run-time skip.
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, grepInvert: [tagPattern("@phone"), ...ciExcluded] },
    { name: "phone", use: { ...devices["Pixel 7"] }, grepInvert: [tagPattern("@desktop"), ...ciExcluded] },
  ],
  webServer: ci
    ? {
        command: `node scripts/with-env.mjs next start --port ${port}`,
        cwd: repoRoot,
        url: `${baseURL}/api/v1/health`,
        reuseExistingServer: false,
        timeout: 180_000,
      }
    : undefined,
});
