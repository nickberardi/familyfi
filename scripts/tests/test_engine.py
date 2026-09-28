from pathlib import Path
import tempfile
import unittest
from unittest import mock

from support import Args, load
from testing import engine, planning
from testing.reporting import Report


class FakeResources:
    def __init__(self, root, fail_database=()):
        self.root, self.fail_database, self.cleaned, self.databases = Path(root), set(fail_database), [], []

    def test_env(self, platform, timezone=None):
        return {"PLATFORM": platform}

    def database(self, platform, env):
        if platform in self.fail_database:
            raise RuntimeError(f"no database for {platform}")
        self.databases.append(platform)

    def migrate(self, env, **_):
        pass

    def port(self, platform):
        return 20000

    def cleanup(self, platform=None):
        self.cleaned.append(platform)


def passing(*args, status="passed"):
    group = args[2]
    return {s["test"]: {"test": s["test"], "status": status, "detail": ""} for s in group}, None


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.tests, self.categories = load()
        self.lookup = {t["id"]: t for t in self.tests}
        self.report = Report(self.directory, "run", quiet=True)
        patches = [mock.patch.object(engine, "preflight"), mock.patch.object(engine, "build"),
                   mock.patch.object(engine.adapters, "python", side_effect=passing),
                   mock.patch.object(engine.adapters, "vitest", side_effect=lambda *a, **k: (*passing(*a), None)),
                   mock.patch.object(engine.adapters, "playwright", side_effect=passing)]
        self.mocks = [p.start() for p in patches]
        self.addCleanup(mock.patch.stopall)
        self.addCleanup(self.temporary.cleanup)

    def execute(self, resources, **filters):
        plan = planning.plan(self.tests, known_categories=self.categories, **filters)
        return engine.execute(plan, resources, self.report, Args(), self.lookup)

    def statuses(self):
        return {(r["platform"], r["test"]): r["status"] for r in self.report.results}

    def test_a_failed_environment_blocks_its_steps_and_the_next_one_still_runs(self):
        resources = FakeResources(self.directory, fail_database={"desktop"})
        self.execute(resources, layers=["ui"])
        statuses = self.statuses()
        self.assertEqual(statuses[("desktop", "desktop/setup")], "infrastructure-error")
        self.assertEqual(statuses[("desktop", "tests/browser/pair.spec.ts > publishes a route")], "blocked")
        self.assertEqual(statuses[("phone", "tests/browser/mobile-nav.spec.ts > opens the drawer")], "passed")
        self.assertEqual(resources.cleaned, ["desktop", "phone"])

    def test_a_failed_build_is_tried_once_and_blocks_every_browser_environment(self):
        self.mocks[1].side_effect = RuntimeError("next build exited 1")
        self.execute(FakeResources(self.directory), layers=["ui"])
        self.assertEqual(self.mocks[1].call_count, 1)
        blocked = {p for (p, t), s in self.statuses().items() if s == "blocked"}
        self.assertEqual(blocked, {"desktop", "phone"})

    def test_a_crashing_batch_leaves_later_batches_running(self):
        self.mocks[2].side_effect = RuntimeError("python exploded")
        self.execute(FakeResources(self.directory), platforms=["host"])
        statuses = self.statuses()
        self.assertEqual(statuses[("host", "scripts/tests/test_x.py > XTests > test_one")], "infrastructure-error")
        self.assertEqual(statuses[("host", "tests/unit/schedule.test.ts > nextTransition > crosses midnight")], "passed")

    def test_host_batches_run_in_a_fixed_order_and_only_integration_needs_a_database(self):
        resources = FakeResources(self.directory)
        self.execute(resources, platforms=["host"])
        layers = [call.args[2][0]["layer"] for call in self.mocks[3].call_args_list]
        self.assertEqual(layers, ["unit", "integration"])
        self.assertEqual(resources.databases, ["host"])

    def test_coverage_runs_unit_and_integration_in_one_invocation(self):
        self.execute(FakeResources(self.directory), platforms=["host"], coverage=True)
        (call,) = self.mocks[3].call_args_list
        self.assertEqual({s["layer"] for s in call.args[2]}, {"unit", "integration"})
        self.assertEqual(call.args[7], self.directory / "coverage")

    def test_cancellation_marks_what_did_not_run_and_still_cleans_up(self):
        self.mocks[3].side_effect = KeyboardInterrupt("Signal 2")
        resources = FakeResources(self.directory)
        with self.assertRaises(KeyboardInterrupt):
            self.execute(resources, platforms=["host"])
        self.assertIn("cancelled", self.statuses().values())
        self.assertEqual(resources.cleaned, ["host"])


if __name__ == "__main__":
    unittest.main()
