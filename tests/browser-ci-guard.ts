import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";

/**
 * Tags a browser test carries when it cannot run in CI, each with the reason. CI leaves
 * these tests out rather than letting them skip, so the decision sits in the spec where
 * review sees it. Empty today; an entry looks like `"@needs-gateway": "a live UniFi console"`.
 */
export const CI_EXCLUDED_TAGS: Record<string, string> = {};

/**
 * CI reporter: a test that skips at run time did not run, so the run fails. Tests that
 * belong to one viewport are tagged `@desktop` or `@phone` and never reach the other
 * project; tests that cannot run in CI take a tag from `CI_EXCLUDED_TAGS`.
 */
export default class BrowserCiGuard implements Reporter {
  private readonly skipped: string[] = [];

  onBegin() {
    for (const [tag, reason] of Object.entries(CI_EXCLUDED_TAGS)) {
      console.log(`Left out of CI: tests tagged ${tag} (${reason})`);
    }
  }

  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status !== "skipped") return;
    // A run-time skip is reported on both the test and the result, so keep each reason once.
    const reasons = new Set(
      [...test.annotations, ...result.annotations]
        .filter((annotation) => annotation.type === "skip")
        .map((annotation) => annotation.description ?? ""),
    );
    this.skipped.push(`${test.titlePath().slice(1).join(" › ")}: ${[...reasons].join("; ") || "no reason given"}`);
  }

  async onEnd() {
    if (!this.skipped.length) return;
    console.error(
      `Browser tests skipped in CI, so they did not run. Fix the cause, or tag the test from CI_EXCLUDED_TAGS in tests/browser-ci-guard.ts:\n  ${this.skipped.join("\n  ")}`,
    );
    return { status: "failed" as const };
  }
}
