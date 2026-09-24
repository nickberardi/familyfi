import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import {
  GATED_PATHS,
  assess,
  exemptionReason,
  isGated,
  parseChangedLines,
  parseLcov,
} from "../../scripts/changed-line-coverage.mjs";

describe("changed-line coverage gate", () => {
  it("gates the security-critical server paths and nothing else", () => {
    expect(isGated("src/server/unifi/policy-ownership.ts")).toBe(true);
    expect(isGated("src/server/unifi/deep/nested.ts")).toBe(true);
    expect(isGated("src/server/tunnel/phone-gateway.ts")).toBe(true);
    expect(isGated("src/server/auth.ts")).toBe(true);
    expect(isGated("src/server/guard.ts")).toBe(true);
    expect(isGated("src/server/quarantine.ts")).toBe(true);
    expect(isGated("src/server/reconciliation.ts")).toBe(true);

    expect(isGated("src/server/unifi-settings.ts")).toBe(false);
    expect(isGated("src/server/auth-extra.ts")).toBe(false);
    expect(isGated("src/server/upstream/probe.ts")).toBe(false);
    expect(isGated("src/lib/schedule.ts")).toBe(false);
  });

  it("names only paths that exist", () => {
    for (const entry of GATED_PATHS) expect(existsSync(entry.replace(/\/\*\*$/, "")), entry).toBe(true);
  });

  it("reads added lines from a zero-context diff", () => {
    const diff = [
      "diff --git a/src/server/auth.ts b/src/server/auth.ts",
      "--- a/src/server/auth.ts",
      "+++ b/src/server/auth.ts",
      "@@ -10,0 +11,2 @@ export function x() {",
      "+  one",
      "+  two",
      "@@ -40 +42 @@",
      "-old",
      "+new",
      "diff --git a/src/server/gone.ts b/src/server/gone.ts",
      "--- a/src/server/gone.ts",
      "+++ /dev/null",
      "@@ -1,3 +0,0 @@",
    ].join("\n");
    expect(parseChangedLines(diff)).toEqual(new Map([["src/server/auth.ts", new Set([11, 12, 42])]]));
  });

  it("reads hit counts per file from lcov", () => {
    const lcov = ["SF:src/server/auth.ts", "DA:1,3", "DA:2,0", "end_of_record", "SF:src/lib/a.ts", "DA:5,1", "end_of_record"].join("\n");
    expect(parseLcov(lcov, "/repo")).toEqual(
      new Map([
        ["src/server/auth.ts", new Map([[1, 3], [2, 0]])],
        ["src/lib/a.ts", new Map([[5, 1]])],
      ]),
    );
  });

  it("takes an exemption on the line or alone on the line above, and only with a reason", () => {
    const source = [
      "const a = 1; // coverage-exempt: process exit, no test can observe it",
      "// coverage-exempt: unreachable while Node keeps its event loop",
      "const b = 2;",
      "const c = 3; // coverage-exempt:",
      "const d = run(); // coverage-exempt: only the line itself",
      "const e = 4;",
    ];
    expect(exemptionReason(source, 1)).toBe("process exit, no test can observe it");
    expect(exemptionReason(source, 3)).toBe("unreachable while Node keeps its event loop");
    expect(exemptionReason(source, 4)).toBeUndefined();
    // A trailing marker covers its own line, never the next one.
    expect(exemptionReason(source, 6)).toBeUndefined();
  });

  it("fails uncovered lines in gated paths, reports them elsewhere, and lists exemptions", () => {
    const sources: Record<string, string[]> = {
      "src/server/reconciliation.ts": ["a()", "b()", "c() // coverage-exempt: the gateway cannot be made to do this", "d()"],
      "src/server/upstream/probe.ts": ["x()", "y()"],
    };
    const result = assess({
      changed: new Map([
        ["src/server/reconciliation.ts", new Set([1, 2, 3, 4])],
        ["src/server/upstream/probe.ts", new Set([1, 2])],
        ["src/app/page.tsx", new Set([1])],
      ]),
      hits: new Map([
        ["src/server/reconciliation.ts", new Map([[1, 4], [2, 0], [3, 0]])],
        ["src/server/upstream/probe.ts", new Map([[1, 0], [2, 1]])],
      ]),
      readSource: (file: string) => sources[file]!,
    });
    expect(result.executable).toBe(5);
    expect(result.uncovered).toEqual([
      { file: "src/server/reconciliation.ts", line: 2, gated: true },
      { file: "src/server/upstream/probe.ts", line: 1, gated: false },
    ]);
    expect(result.exempt).toEqual([
      { file: "src/server/reconciliation.ts", line: 3, reason: "the gateway cannot be made to do this" },
    ]);
  });
});
