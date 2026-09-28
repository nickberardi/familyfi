from pathlib import Path
import tempfile
import unittest

from support import DISCOVERED, ENTRIES, identity, load, write_catalog
from testing import catalog


def ids(selected):
    return [t["id"] for t in selected]


class CatalogTests(unittest.TestCase):
    def test_categories_accumulate_from_file_and_test_entries(self):
        tests, _ = load()
        by_id = {t["id"]: t for t in tests}
        self.assertEqual(by_id["tests/unit/schedule.test.ts > nextTransition > keeps the zone"]["categories"],
                         ["display", "schedules"])
        self.assertEqual(by_id["scripts/tests/test_x.py > XTests > test_one"]["categories"], ["test-infrastructure"])

    def test_an_uncategorized_test_fails(self):
        with self.assertRaisesRegex(ValueError, "Uncategorized test: tests/unit/new.test.ts"):
            load(discovered=[*DISCOVERED, identity("tests/unit/new.test.ts", "new", "works")])

    def test_an_entry_that_names_no_test_fails(self):
        with self.assertRaisesRegex(ValueError, "name no tests"):
            load(entries={**ENTRIES, "tests/unit/gone.test.ts": ["sync"]})

    def test_an_undeclared_category_fails(self):
        with tempfile.TemporaryDirectory() as directory, self.assertRaisesRegex(ValueError, "Unknown categories"):
            path = write_catalog(directory, categories=["sync"])
            catalog.load(Path(directory), path=path, discovered=DISCOVERED)

    def test_a_prefix_selects_on_title_boundaries_only(self):
        self.assertTrue(catalog.matches("a.test.ts > b > c", "a.test.ts > b"))
        self.assertFalse(catalog.matches("a.test.ts > bc > c", "a.test.ts > b"))
        self.assertTrue(catalog.matches("tests/unit/a.test.ts > b", "tests/unit/"))


class SelectionTests(unittest.TestCase):
    def setUp(self):
        self.tests, self.categories = load()

    def select(self, **filters):
        return catalog.select(self.tests, known_categories=self.categories, **filters)

    def test_values_in_one_filter_are_a_union_and_filters_intersect(self):
        selected, _ = self.select(categories=["sync,navigation"], layers=["unit", "ui"])
        self.assertEqual(ids(selected), ["tests/unit/sync/schedule.test.ts > sync schedule > runs",
                                         "tests/browser/mobile-nav.spec.ts > opens the drawer"])

    def test_all_platforms_is_the_default_and_host_runs_once(self):
        _, platforms = self.select(layers=["unit"])
        self.assertEqual(platforms, ["host", "desktop", "phone"])
        _, platforms = self.select(platforms=["phone"])
        self.assertEqual(platforms, ["host", "phone"])
        _, platforms = self.select(platforms=["phone"], exclude_host=True)
        self.assertEqual(platforms, ["phone"])

    def test_a_platform_restricts_browser_tests_to_its_project(self):
        selected, _ = self.select(platforms=["desktop"], layers=["ui"])
        self.assertEqual(ids(selected), ["tests/browser/pair.spec.ts > publishes a route",
                                         "tests/browser/pair.spec.ts > revokes the route"])

    def test_a_short_selector_resolves_when_unambiguous(self):
        selected, _ = self.select(selectors=["unit/schedule.test.ts > nextTransition > crosses midnight"])
        self.assertEqual(ids(selected), ["tests/unit/schedule.test.ts > nextTransition > crosses midnight"])
        selected, _ = self.select(selectors=["reconcile.test.ts"])
        self.assertEqual(len(selected), 2)

    def test_an_ambiguous_file_name_names_the_candidates(self):
        with self.assertRaisesRegex(ValueError, "Ambiguous selector.*tests/unit/schedule.test.ts.*sync/schedule"):
            self.select(selectors=["schedule.test.ts"])

    def test_a_directory_selector_is_never_ambiguous(self):
        selected, _ = self.select(selectors=["tests/unit/"])
        self.assertEqual(len(selected), 3)

    def test_unknown_values_fail_before_anything_runs(self):
        for filters, message in [({"selectors": ["nope.test.ts"]}, "Unknown selector"),
                                 ({"categories": ["nope"]}, "Unknown category"),
                                 ({"layers": ["e2e"]}, "Layers must be"),
                                 ({"platforms": ["ipad"]}, "Unknown platform")]:
            with self.subTest(filters=filters), self.assertRaisesRegex(ValueError, message):
                self.select(**filters)

    def test_an_empty_intersection_fails(self):
        with self.assertRaisesRegex(ValueError, "no applicable tests"):
            self.select(categories=["pairing"], layers=["unit"])

    def test_a_declared_but_unused_category_selects_nothing(self):
        with self.assertRaisesRegex(ValueError, "no applicable tests"):
            self.select(categories=["accessibility"])


if __name__ == "__main__":
    unittest.main()
