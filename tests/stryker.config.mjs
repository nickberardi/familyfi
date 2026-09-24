/**
 * Mutation testing: Stryker makes small deliberate bugs in the code below, one at a time,
 * and runs the unit and integration tests against each. A mutant no test notices
 * "survives", and names a behaviour the tests never check. Scoped to the code where a
 * silent bug would change what a household's gateway enforces. Not a gate: see
 * docs/testing.md.
 */
const config = {
  testRunner: "vitest",
  // pnpm keeps packages apart, so Stryker cannot discover the runner by scanning.
  plugins: ["@stryker-mutator/vitest-runner"],
  vitest: { configFile: "tests/vitest.coverage.config.ts" },
  mutate: [
    "src/server/reconciliation.ts",
    "src/server/quarantine.ts",
    "src/server/unifi/plan.ts",
    "src/server/unifi/plan-dpi.ts",
    "src/server/unifi/policy-ownership.ts",
    "src/lib/schedule.ts",
  ],
  coverageAnalysis: "perTest",
  // The integration tests share one database, so mutants run one at a time.
  concurrency: 1,
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  thresholds: { high: 80, low: 60, break: null },
  tempDirName: ".stryker-tmp",
  ignorePatterns: [".next", "coverage", "reports", "test-results", "designs", ".stryker-tmp"],
};

export default config;
