import { defineConfig } from "vitest/config";
import unit from "./vitest.config";
import integration from "./vitest.integration.config";

/**
 * Unit and integration tests in one run, so coverage counts both: most server code is
 * exercised by one or the other, and a floor on either alone would mislead.
 */
export default defineConfig({
  test: {
    projects: [
      { ...unit, test: { ...unit.test, name: "unit" } },
      { ...integration, test: { ...integration.test, name: "integration" } },
    ],
    coverage: {
      provider: "v8",
      // Logic that runs on the server or in shared lib code. Pages and components are
      // exercised by the browser suite, which this does not measure.
      include: ["src/server/**/*.ts", "src/lib/**/*.ts", "src/app/api/**/*.ts"],
      exclude: ["src/server/unifi/spike.ts", "src/server/dev-seed.ts"],
      reporter: ["text-summary", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      /**
       * Floors, set just under what the suites reach today (September 2026), so coverage
       * can rise but not fall. Raise one whenever you lift an area; never lower one to
       * pass. The reconciler's branch floor has extra room because the property test
       * takes random paths and moves it by about a point and a half between runs.
       */
      thresholds: {
        lines: 83,
        statements: 78,
        functions: 83,
        branches: 66,
        "src/server/unifi/**": { lines: 80, statements: 75, functions: 73, branches: 65 },
        "src/server/unifi/policy-ownership.ts": { lines: 100, statements: 100, functions: 100, branches: 100 },
        "src/server/reconciliation.ts": { lines: 70, statements: 67, functions: 77, branches: 58 },
        "src/server/quarantine.ts": { lines: 100, statements: 100, functions: 100, branches: 90 },
        "src/server/auth.ts": { lines: 88, statements: 87, functions: 100, branches: 83 },
        "src/server/guard.ts": { lines: 83, statements: 87, functions: 100, branches: 100 },
        "src/server/tunnel/**": { lines: 85, statements: 81, functions: 77, branches: 74 },
        "src/server/upstream/**": { lines: 94, statements: 89, functions: 87, branches: 80 },
        "src/lib/schedule.ts": { lines: 94, statements: 93, functions: 100, branches: 90 },
      },
    },
  },
});
