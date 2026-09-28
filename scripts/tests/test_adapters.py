import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from support import Args, load
from testing import adapters, planning

ROOT = Path("/repo")


def steps(tests, categories, **filters):
    plan = planning.plan(tests, known_categories=categories, **filters)
    return {e["platform"]: e["steps"] for e in plan["environments"]}


def vitest_file(path, *cases, status="passed", message=""):
    return {"name": str(ROOT / path), "status": status, "message": message,
            "assertionResults": [{"ancestorTitles": list(titles), "title": title, "status": state,
                                  "duration": 12, "failureMessages": [failure] if failure else []}
                                 for *titles, title, state, failure in cases]}


def playwright_spec(title, project, status, expected="passed", line=1, errors=()):
    return {"title": title, "line": line, "tests": [{
        "projectName": project, "status": status, "expectedStatus": expected, "annotations": [],
        "results": [{"duration": 1000, "errors": [{"message": m} for m in errors]}]}]}


class VitestResultTests(unittest.TestCase):
    def setUp(self):
        self.tests, self.categories = load()
        self.steps = steps(self.tests, self.categories, selectors=["tests/unit/schedule.test.ts"])["host"]

    def test_outcomes_come_from_the_json_report(self):
        payload = {"testResults": [vitest_file("tests/unit/schedule.test.ts",
                                               ("nextTransition", "crosses midnight", "passed", ""),
                                               ("nextTransition", "keeps the zone", "failed", "\x1b[31mexpected 1\x1b[0m"))]}
        actual, errors = adapters.vitest_cases(payload, ROOT)
        cases = adapters.finish_cases(self.steps, actual, errors)
        self.assertEqual([c["status"] for c in cases.values()], ["passed", "failed"])
        self.assertEqual(cases["tests/unit/schedule.test.ts > nextTransition > keeps the zone"]["detail"], "expected 1")

    def test_a_file_that_failed_to_load_fails_its_tests_with_the_reason(self):
        payload = {"testResults": [vitest_file("tests/unit/schedule.test.ts", status="failed",
                                               message="SyntaxError: Unexpected token")]}
        cases = adapters.finish_cases(self.steps, *adapters.vitest_cases(payload, ROOT))
        self.assertEqual({(c["status"], c["detail"]) for c in cases.values()},
                         {("failed", "SyntaxError: Unexpected token")})

    def test_a_missing_result_is_an_infrastructure_error(self):
        cases = adapters.finish_cases(self.steps, {})
        self.assertEqual({c["status"] for c in cases.values()}, {"infrastructure-error"})

    def test_a_skip_fails_and_an_all_skipped_run_says_nothing_ran(self):
        payload = {"testResults": [vitest_file("tests/unit/schedule.test.ts",
                                               ("nextTransition", "crosses midnight", "skipped", ""),
                                               ("nextTransition", "keeps the zone", "passed", ""))]}
        cases = adapters.finish_cases(self.steps, *adapters.vitest_cases(payload, ROOT))
        self.assertTrue(cases["tests/unit/schedule.test.ts > nextTransition > crosses midnight"]["detail"]
                        .startswith("Unexpected skip"))
        payload["testResults"][0]["assertionResults"][1]["status"] = "todo"
        cases = adapters.finish_cases(self.steps, *adapters.vitest_cases(payload, ROOT))
        self.assertEqual({c["detail"] for c in cases.values()}, {"All selected tests skipped; nothing was exercised"})

    def test_unselected_tests_in_a_file_are_ignored(self):
        one = steps(self.tests, self.categories,
                    selectors=["tests/unit/schedule.test.ts > nextTransition > keeps the zone"])["host"]
        payload = {"testResults": [vitest_file("tests/unit/schedule.test.ts",
                                               ("nextTransition", "crosses midnight", "skipped", ""),
                                               ("nextTransition", "keeps the zone", "passed", ""))]}
        cases = adapters.finish_cases(one, *adapters.vitest_cases(payload, ROOT))
        self.assertEqual(list(cases.values())[0]["status"], "passed")
        self.assertEqual(len(cases), 1)

    def test_filters_name_whole_files_or_single_lines(self):
        lookup = {t["id"]: t for t in self.tests}
        self.assertEqual(adapters.filters(self.steps, lookup), ["tests/unit/schedule.test.ts"])
        one = steps(self.tests, self.categories,
                    selectors=["tests/unit/schedule.test.ts > nextTransition > keeps the zone"])["host"]
        self.assertEqual(adapters.filters(one, lookup), ["tests/unit/schedule.test.ts:9"])


class PlaywrightResultTests(unittest.TestCase):
    def setUp(self):
        self.tests, self.categories = load()
        self.steps = steps(self.tests, self.categories, selectors=["tests/browser/pair.spec.ts"],
                           platforms=["desktop"], exclude_host=True)["desktop"]

    def payload(self, *specs):
        return {"suites": [{"file": "pair.spec.ts", "title": "pair.spec.ts", "specs": list(specs), "suites": []}],
                "errors": []}

    def test_a_pass_on_retry_fails_and_the_serial_rest_is_blocked(self):
        actual, _ = adapters.playwright_cases(self.payload(
            playwright_spec("publishes a route", "desktop", "flaky"),
            playwright_spec("revokes the route", "desktop", "skipped"),
            playwright_spec("publishes a route", "phone", "expected")), "desktop")
        cases = adapters.finish_cases(self.steps, actual)
        first, second = cases.values()
        self.assertEqual(first["status"], "failed")
        self.assertIn("retry", first["detail"])
        self.assertEqual(second["status"], "blocked")

    def test_an_expected_failure_is_reported_as_one(self):
        actual, _ = adapters.playwright_cases(self.payload(
            playwright_spec("publishes a route", "desktop", "expected", expected="failed"),
            playwright_spec("revokes the route", "desktop", "unexpected", errors=["boom"])), "desktop")
        cases = adapters.finish_cases(self.steps, actual)
        self.assertEqual([(c["status"], c["detail"]) for c in cases.values()],
                         [("expected-failure", ""), ("failed", "boom")])

    def test_run_level_errors_are_returned(self):
        payload = self.payload()
        payload["errors"] = [{"message": "Timed out waiting 180000ms from config.webServer."}]
        _, errors = adapters.playwright_cases(payload, "desktop")
        self.assertEqual(errors, ["Timed out waiting 180000ms from config.webServer."])


class CoverageFloorTests(unittest.TestCase):
    """Vitest enforces the floors and exits non-zero on a miss even when every test passed."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        tests, categories = load()
        self.lookup = {t["id"]: t for t in tests}
        self.steps = steps(tests, categories, platforms=["host"], coverage=True)["host"]
        self.steps = [s for s in self.steps if s["adapter"] == "vitest"]
        self.resources = mock.Mock(root=ROOT)

    def vitest(self, code, output, status="passed", coverage=True):
        sources = dict.fromkeys(s["source"] for s in self.steps)
        payload = {"testResults": [vitest_file(source, *[(*s["test"].split(" > ")[1:], status, "")
                                                         for s in self.steps if s["source"] == source])
                                   for source in sources]}
        def fake_run(command, **kwargs):
            (self.directory / "vitest.json").write_text(json.dumps(payload))
            return code, output
        with mock.patch.object(adapters, "run", fake_run), mock.patch.object(adapters, "tool", return_value="vitest"):
            return adapters.vitest(self.resources, mock.Mock(), self.steps, self.directory, {}, Args(),
                                   self.lookup, self.directory / "coverage" if coverage else None)

    def test_a_missed_floor_fails_though_every_test_passed(self):
        cases, error, floors = self.vitest(1, "ERROR: Coverage for lines (80%) does not meet global threshold (83%)\n")
        self.assertEqual({c["status"] for c in cases.values()}, {"passed"})
        self.assertEqual(floors, "ERROR: Coverage for lines (80%) does not meet global threshold (83%)")
        self.assertIsNone(error)

    def test_floors_met_is_an_empty_verdict(self):
        self.assertEqual(self.vitest(0, "All files | 90\n")[1:], (None, ""))

    def test_floors_are_not_claimed_when_a_test_failed(self):
        self.assertIsNone(self.vitest(1, "1 failed\n", status="failed")[2])

    def test_a_failing_exit_with_every_case_passed_is_an_error_not_a_pass(self):
        """Vitest exits 1 for an unhandled rejection that no case records."""
        for coverage in (True, False):
            with self.subTest(coverage=coverage):
                cases, error, floors = self.vitest(1, "Unhandled Rejection: leaked\n", coverage=coverage)
                self.assertEqual({c["status"] for c in cases.values()}, {"passed"})
                self.assertIn("Vitest exited 1 though every selected test passed", error)
                self.assertIn("leaked", error)
                self.assertIsNone(floors)


if __name__ == "__main__":
    unittest.main()
