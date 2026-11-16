from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest import mock

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



class DiscoveryCacheTests(unittest.TestCase):
    """identities() lists once per state of its inputs, and never serves a listing older than them."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for path, text in {"tests/unit/a.test.ts": "a", "src/lib/x.ts": "x", "package.json": "{}",
                           "README.md": "readme", ".gitignore": "/node_modules\n"}.items():
            (self.root / path).parent.mkdir(parents=True, exist_ok=True)
            (self.root / path).write_text(text)
        (self.root / "node_modules/.bin").mkdir(parents=True)
        for name in ("vitest", "playwright"):
            (self.root / "node_modules/.bin" / name).write_text("")
        git = ["git", "-c", "user.email=t@example.com", "-c", "user.name=t"]
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        subprocess.run(["git", "add", "-A"], cwd=self.root, check=True)
        subprocess.run([*git, "commit", "-qm", "init"], cwd=self.root, check=True)
        self.calls, lock = 0, threading.Lock()

        def runner_json(command, root, env, output_env=None):
            with lock:  # the three listings run in parallel
                self.calls += 1
            if output_env:
                return {"suites": []}
            return [{"file": str(Path(root) / "tests/unit/a.test.ts"), "name": f"{command[3]} {self.calls}"}]
        patcher = mock.patch.object(catalog, "runner_json", side_effect=runner_json)
        patcher.start()
        self.addCleanup(patcher.stop)

    def listings(self, **kwargs):
        before = self.calls
        found = catalog.identities(self.root, **kwargs)
        return self.calls - before, found

    def test_a_second_discovery_of_the_same_inputs_lists_nothing(self):
        listed, first = self.listings()
        self.assertEqual(listed, 3)
        listed, second = self.listings()
        self.assertEqual((listed, second), (0, first))

    def test_a_changed_file_is_listed_again(self):
        self.listings()
        (self.root / "src/lib/x.ts").write_text("changed, not staged")
        self.assertEqual(self.listings()[0], 3)
        self.assertEqual(self.listings()[0], 0)
        # Test names come from outside the tests too (AGENTS.md's invariants name theirs).
        (self.root / "README.md").write_text("an invariant reworded")
        self.assertEqual(self.listings()[0], 3)
        self.assertEqual(self.listings()[0], 0)

    def test_an_untracked_test_is_listed_again(self):
        self.listings()
        (self.root / "tests/unit/b.test.ts").write_text("new")
        self.assertEqual(self.listings()[0], 3)

    def test_a_full_listing_ignores_and_refreshes_what_is_kept(self):
        self.listings()
        listed, fresh = self.listings(cache=False)
        self.assertEqual(listed, 3)
        self.assertEqual(self.listings(), (0, fresh))

    def test_outside_a_git_checkout_nothing_is_kept(self):
        subprocess.run(["rm", "-rf", str(self.root / ".git")], check=True)
        self.assertEqual(self.listings()[0], 3)
        self.assertEqual(self.listings()[0], 3)
        self.assertFalse(list((self.root / "build/test-cache").glob("discovery-*.json")))


if __name__ == "__main__":
    unittest.main()
