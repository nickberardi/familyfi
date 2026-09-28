import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from testing.reporting import Report


class ReportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.report = Report(self.directory, "run", quiet=True)
        self.addCleanup(self.temporary.cleanup)

    def finish(self):
        with mock.patch.dict("os.environ", {"GITHUB_STEP_SUMMARY": ""}):
            code = self.report.finish(self.directory / "cache")
        return code, json.loads((self.directory / "results.json").read_text())

    def test_nothing_run_is_a_failure(self):
        code, results = self.finish()
        self.assertEqual((code, results["status"]), (1, "failed"))
        self.assertIn("Nothing ran", (self.directory / "summary.md").read_text())

    def test_expected_failures_pass_and_every_bad_status_fails(self):
        self.report.result("a", "passed")
        self.report.result("b", "expected-failure")
        self.assertEqual(self.finish()[0], 0)
        for status in ("failed", "blocked", "cancelled", "infrastructure-error"):
            with self.subTest(status=status):
                report = Report(self.directory, "run", quiet=True)
                report.result("a", "passed")
                report.result("b", status, detail="why")
                self.report = report
                code, results = self.finish()
                self.assertEqual((code, results["counts"]), (1, {"passed": 1, status: 1}))

    def test_the_summary_names_each_failure_and_the_events_stream_every_result(self):
        self.report.result("tests/unit/a.test.ts > works", "failed", detail="expected 1\nreceived 2")
        self.finish()
        self.assertIn("**tests/unit/a.test.ts > works** (host): expected 1", (self.directory / "summary.md").read_text())
        events = [json.loads(line) for line in (self.directory / "events.jsonl").read_text().splitlines()]
        self.assertEqual(events[0]["result"]["status"], "failed")

    def test_a_github_job_gets_the_summary(self):
        self.report.result("a", "passed")
        target = self.directory / "step-summary.md"
        with mock.patch.dict("os.environ", {"GITHUB_STEP_SUMMARY": str(target)}):
            self.report.finish(self.directory / "cache")
        self.assertIn("## Test run run: passed", target.read_text())


if __name__ == "__main__":
    unittest.main()
