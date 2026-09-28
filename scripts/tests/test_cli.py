import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from support import load
from testing import cli
from testing.resources import identity


class CliTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.addCleanup(self.temporary.cleanup)
        patches = [mock.patch.object(cli, "ROOT", self.root), mock.patch.object(cli.catalog, "load", return_value=load())]
        for patch in patches:
            patch.start()
        self.addCleanup(mock.patch.stopall)

    def main(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                code = cli.main(list(argv))
            except SystemExit as exit:
                code = exit.code
        return code, out.getvalue(), err.getvalue()

    def test_a_bare_run_prints_usage_and_starts_nothing(self):
        code, _, err = self.main("run")
        self.assertEqual(code, 2)
        self.assertIn("requires a test, category, layer, or platform", err)
        self.assertFalse((self.root / "build").exists())

    def test_a_plan_creates_no_run(self):
        code, out, _ = self.main("run", "--category", "pairing", "--plan")
        self.assertEqual(code, 0)
        plan = json.loads(out)
        self.assertEqual([e["platform"] for e in plan["environments"]], ["desktop", "phone"])
        self.assertFalse((self.root / "build").exists())

    def test_an_unknown_selector_fails_before_setup(self):
        code, _, err = self.main("run", "nope.test.ts")
        self.assertEqual(code, 2)
        self.assertIn("Unknown selector: nope.test.ts", err)
        self.assertFalse((self.root / "build").exists())

    def test_list_shows_categories_layers_and_platforms(self):
        code, out, _ = self.main("list", "--category", "navigation")
        self.assertEqual(code, 0)
        self.assertIn("tests/browser/mobile-nav.spec.ts > opens the drawer | navigation | ui | phone | serial: no", out)

    def test_run_ids_are_validated_before_any_path_is_used(self):
        for run_id in ("../../etc", "0" * 32):
            with self.subTest(run_id=run_id):
                code, _, err = self.main("cleanup", run_id)
                self.assertEqual(code, 2)
                self.assertRegex(err, "32-character|does not exist")

    def test_cleanup_refuses_a_run_that_is_still_active(self):
        run_id = "a" * 32
        directory = self.root / "build/test-runs" / run_id
        directory.mkdir(parents=True)
        pid = os.getpid()
        (directory / "manifest.json").write_text(json.dumps({
            "version": 1, "root": str(self.root), "run_id": run_id, "pid": pid,
            "process_identity": identity(pid), "containers": [], "ports": [], "processes": [], "complete": False}))
        code, _, err = self.main("cleanup", run_id)
        self.assertEqual(code, 2)
        self.assertIn("Refusing to clean an active run", err)


if __name__ == "__main__":
    unittest.main()
