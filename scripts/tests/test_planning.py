import unittest

from support import load
from testing import planning


class PlanningTests(unittest.TestCase):
    def setUp(self):
        self.tests, self.categories = load()

    def plan(self, **filters):
        return planning.plan(self.tests, known_categories=self.categories, **filters)

    def test_selecting_a_later_serial_test_adds_the_earlier_ones_as_prerequisites(self):
        plan = self.plan(selectors=["tests/browser/pair.spec.ts > revokes the route"], exclude_host=True)
        (desktop,) = plan["environments"]
        self.assertEqual([(s["test"], s["role"], s["depends_on"]) for s in desktop["steps"]], [
            ("tests/browser/pair.spec.ts > publishes a route", "prerequisite", []),
            ("tests/browser/pair.spec.ts > revokes the route", "selected", ["desktop:1"]),
        ])

    def test_serial_prerequisites_stay_on_their_own_platform(self):
        plan = self.plan(selectors=["tests/browser/pair.spec.ts > lays out on a phone"])
        (phone,) = plan["environments"]
        self.assertEqual(phone["platform"], "phone")
        self.assertEqual([(s["role"], s["depends_on"]) for s in phone["steps"]], [("selected", [])])

    def test_resources_follow_the_layers_an_environment_runs(self):
        plan = self.plan(categories=["schedules", "sync", "navigation"])
        shape = {e["platform"]: (e["database"], e["build"]) for e in plan["environments"]}
        self.assertEqual(shape, {"host": (True, False), "phone": (True, True)})
        plan = self.plan(layers=["unit"])
        self.assertEqual([(e["platform"], e["database"]) for e in plan["environments"]], [("host", False)])

    def test_steps_keep_discovery_order(self):
        plan = self.plan(platforms=["host"])
        tests = [s["test"] for s in plan["environments"][0]["steps"]]
        self.assertEqual(tests, [t["id"] for t in self.tests if t["platforms"] == ["host"]])

    def test_coverage_needs_the_whole_host_vitest_suite(self):
        self.assertTrue(self.plan(platforms=["host"], coverage=True)["environments"][0]["coverage"])
        for filters in ({"platforms": ["host"], "layers": ["unit"]}, {"categories": ["sync"]},
                        {"platforms": ["desktop"], "exclude_host": True}):
            with self.subTest(filters=filters), self.assertRaisesRegex(ValueError, "--coverage measures"):
                self.plan(coverage=True, **filters)


if __name__ == "__main__":
    unittest.main()
