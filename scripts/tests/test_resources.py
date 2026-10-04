import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from testing import resources
from testing.resources import Resources, lock, new_run, release_port, reserve_port


class Docker:
    """Records docker commands and answers `inspect` with a label per container."""

    def __init__(self, labels):
        self.labels, self.commands = labels, []

    def __call__(self, command, **kwargs):
        command = list(map(str, command))
        self.commands.append(command)
        if command[:2] == ["docker", "inspect"]:
            name = command[-1]
            if name not in self.labels:
                return 1, f"Error: No such object: {name}"
            return 0, self.labels[name] + "\n"
        return 0, ""


class ResourceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.registry = self.root / "ports"
        self.directory = new_run(self.root)
        self.run_id = self.directory.name

    def tearDown(self):
        self.temporary.cleanup()

    def owned(self, **manifest):
        base = {"version": 1, "root": str(self.root), "run_id": self.run_id, "pid": 1, "process_identity": "",
                "containers": [], "ports": [], "processes": [], "complete": False}
        return Resources(self.directory, self.root, {**base, **manifest}, registry_dir=self.registry)

    def test_a_manifest_naming_a_foreign_container_is_refused(self):
        with self.assertRaisesRegex(RuntimeError, "Foreign container"):
            self.owned(containers=[{"name": "familyfi-db", "platform": "host"}])
        with self.assertRaisesRegex(RuntimeError, "Foreign port"):
            self.owned(ports=["someone-else/host"])

    def test_a_manifest_from_another_worktree_is_refused(self):
        with self.assertRaisesRegex(RuntimeError, "does not belong"):
            Resources(self.directory, self.root, {"root": "/elsewhere", "run_id": self.run_id, "containers": [],
                                                  "ports": [], "processes": []})

    def test_cleanup_removes_only_this_runs_labelled_containers(self):
        mine = f"familyfi-test-{self.run_id}-host"
        docker = Docker({mine: self.run_id})
        owned = self.owned(containers=[{"name": mine, "platform": "host"}])
        with mock.patch.object(resources, "run", docker):
            owned.cleanup()
        self.assertIn(["docker", "rm", "--force", "--volumes", mine], docker.commands)
        self.assertEqual(json.loads((self.directory / "manifest.json").read_text())["containers"], [])

    def test_cleanup_refuses_a_container_labelled_for_another_run(self):
        mine = f"familyfi-test-{self.run_id}-host"
        docker = Docker({mine: "0" * 32})
        owned = self.owned(containers=[{"name": mine, "platform": "host"}])
        with mock.patch.object(resources, "run", docker), self.assertRaisesRegex(RuntimeError, "ownership mismatch"):
            owned.cleanup()
        self.assertFalse(any(c[:2] == ["docker", "rm"] for c in docker.commands))
        self.assertEqual(len(owned.manifest["containers"]), 1)

    def test_cleanup_of_an_already_removed_container_succeeds(self):
        mine = f"familyfi-test-{self.run_id}-phone"
        owned = self.owned(containers=[{"name": mine, "platform": "phone"}])
        with mock.patch.object(resources, "run", Docker({})):
            owned.cleanup()
        self.assertEqual(owned.manifest["containers"], [])

    def test_cleanup_of_one_platform_leaves_the_others(self):
        host, phone = (f"familyfi-test-{self.run_id}-{p}" for p in ("host", "phone"))
        owned = self.owned(containers=[{"name": host, "platform": "host"}, {"name": phone, "platform": "phone"}])
        with mock.patch.object(resources, "run", Docker({host: self.run_id, phone: self.run_id})):
            owned.cleanup("phone")
        self.assertEqual([c["name"] for c in owned.manifest["containers"]], [host])

    def test_ports_are_distinct_until_released(self):
        first = reserve_port("a/desktop", self.registry)
        second = reserve_port("b/desktop", self.registry)
        self.assertNotEqual(first, second)
        release_port("a/desktop", self.registry)
        self.assertEqual(reserve_port("c/desktop", self.registry), first)

    def test_a_second_invocation_in_one_worktree_is_refused_with_the_holder(self):
        with lock(self.root) as holder:
            holder.write(self.run_id); holder.flush()
            with self.assertRaisesRegex(RuntimeError, self.run_id):
                with lock(self.root):
                    pass

    def test_test_processes_never_see_a_developer_database_url(self):
        with mock.patch.dict("os.environ", {"DATABASE_URL": "postgresql://household"}):
            env = self.owned().test_env("host", "Pacific/Kiritimati")
        self.assertNotIn("DATABASE_URL", env)
        self.assertEqual((env["DB_NAME"], env["TZ"]), ("familyfi_test", "Pacific/Kiritimati"))
        self.assertEqual(len(env["FAMILYFI_ENCRYPTION_KEY"]), 64)


if __name__ == "__main__":
    unittest.main()
