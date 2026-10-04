"""Run-owned databases, ports and processes; cleanup never scans for unrelated resources."""
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
import uuid

from .catalog import ROOT, tool
from .process import run
from .reporting import atomic_json

POSTGRES_IMAGE = "postgres:18-alpine"
MEMORY_LAUNCHER = "scripts/runtime/memory-database.mjs"
TEST_DATABASE = "familyfi_test"
LABEL = "familyfi.test-run"


def identity(pid):
    result = subprocess.run(["ps", "-p", str(pid), "-o", "lstart="], capture_output=True, text=True, timeout=5)
    return result.stdout.strip() if result.returncode == 0 else ""


def active(manifest):
    return bool(manifest.get("process_identity")) and identity(manifest["pid"]) == manifest["process_identity"]


@contextmanager
def lock(root):
    cache = Path(root) / "build/test-cache"
    cache.mkdir(parents=True, exist_ok=True)
    with (cache / "lock").open("a+") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            handle.seek(0)
            raise RuntimeError(f"Another invocation owns this worktree: {handle.read().strip()}") from error
        yield handle


def preflight(root=ROOT, docker=False, browser=False):
    tool(root, "vitest")
    if browser:
        free = shutil.disk_usage(root).free / 2**30
        if free < 20:
            print(f"Space notice: {free:.1f} GiB currently free (repository guidance: 20 GiB). "
                  "Continuing; reclaimable space is not included in this measurement.", file=sys.stderr)
        probe = ("const {chromium}=require('@playwright/test');"
                 "process.exit(require('fs').existsSync(chromium.executablePath())?0:1)")
        if subprocess.run(["node", "-e", probe], cwd=root, capture_output=True, timeout=60).returncode:
            raise RuntimeError("Chromium for Playwright is missing: pnpm exec playwright install chromium")
    if docker:
        run(["docker", "info"], cwd=root, timeout=30, idle=0)


def pnpm(root=ROOT):
    """The pnpm package.json pins, whether or not this machine has it."""
    wanted = json.loads((Path(root) / "package.json").read_text())["packageManager"].split("@", 1)[1]
    if shutil.which("pnpm"):
        found = subprocess.run(["pnpm", "--version"], capture_output=True, text=True, timeout=30)
        if found.stdout.strip() == wanted:
            return ["pnpm"]
    return ["npx", "--yes", f"pnpm@{wanted}"]


def registry(directory=None):
    base = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache")
    return Path(directory or base / "familyfi-test-ports")


def reserve_port(owner, registry_dir=None):
    directory = registry(registry_dir)
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / "lock").open("a+") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        path = directory / "ports.json"
        entries = json.loads(path.read_text()) if path.exists() else {}
        used = set(entries.values())
        for port in range(20000, 50000):
            if port in used:
                continue
            try:
                with socket.socket() as sock:
                    sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            entries[owner] = port
            atomic_json(path, entries)
            return port
        raise RuntimeError("No free loopback port for the web server")


def release_port(owner, registry_dir=None):
    directory = registry(registry_dir)
    if not directory.exists():
        return
    with (directory / "lock").open("a+") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        path = directory / "ports.json"
        entries = json.loads(path.read_text()) if path.exists() else {}
        entries.pop(owner, None)
        atomic_json(path, entries)


class Resources:
    def __init__(self, directory, root=ROOT, manifest=None, registry_dir=None):
        self.root, self.directory = Path(root).resolve(), Path(directory).resolve()
        self.registry_dir = registry_dir
        # As `pnpm run` does, so config commands such as Playwright's `next start` resolve.
        self.env = {**os.environ, "PATH": os.pathsep.join([str(self.root / "node_modules/.bin"), os.environ.get("PATH", "")])}
        # A developer's database URL must never reach a test process.
        self.env.pop("DATABASE_URL", None)
        self.env.pop("FAMILYFI_TEST_DISCOVERY", None)
        self.manifest = manifest or {"version": 1, "root": str(self.root), "run_id": self.directory.name,
                                     "pid": os.getpid(), "process_identity": identity(os.getpid()),
                                     "containers": [], "ports": [], "processes": [], "complete": False}
        self.secrets = {}
        self.validate()
        self.save()

    def save(self):
        atomic_json(self.directory / "manifest.json", self.manifest)

    def command(self, command, env=None, **kwargs):
        return run(command, cwd=self.root, env=env or self.env, owner=self, **kwargs)[1]

    def track_process(self, process):
        self.manifest["processes"].append({"pid": process.pid, "identity": identity(process.pid)})
        self.save()

    def untrack_process(self, pid):
        self.manifest["processes"] = [p for p in self.manifest["processes"] if p["pid"] != pid]
        self.save()

    def test_env(self, platform, timezone=None):
        """Fresh test-only secrets per environment; nothing is read from or written to .env."""
        values = self.secrets.setdefault(platform, {
            "FAMILYFI_DEFAULT_PASSWORD": secrets.token_urlsafe(18),
            "FAMILYFI_SESSION_SECRET": secrets.token_hex(16),
            "FAMILYFI_ENCRYPTION_KEY": secrets.token_hex(32),
            "POSTGRES_PASSWORD": secrets.token_urlsafe(18)})
        env = {**self.env, **values, "DB_MODE": "external", "DB_HOST": "127.0.0.1",
               "POSTGRES_DB": TEST_DATABASE, "POSTGRES_USER": "familyfi"}
        env.pop("POSTGRES_PORT", None)
        if timezone:
            env["TZ"] = timezone
        return env

    def database(self, platform, env):
        """Start this environment's PostgreSQL and point `env` at it."""
        name = f"familyfi-test-{self.directory.name}-{platform}"
        self.manifest["containers"].append({"name": name, "platform": platform}); self.save()
        self.command(["docker", "run", "--detach", "--name", name, "--label", f"{LABEL}={self.directory.name}",
                      "--publish", "127.0.0.1::5432", "--env", f"POSTGRES_USER={env['POSTGRES_USER']}",
                      "--env", f"POSTGRES_DB={env['POSTGRES_DB']}", "--env", "POSTGRES_PASSWORD",
                      # Over TCP: while the image initialises, a temporary server answers on the socket only, then restarts.
                      "--health-cmd", f"pg_isready -h 127.0.0.1 -U {env['POSTGRES_USER']} -d {env['POSTGRES_DB']}",
                      "--health-interval", "1s", "--health-timeout", "5s", "--health-retries", "60",
                      POSTGRES_IMAGE], env=env, timeout=300, idle=0)
        deadline = time.monotonic() + 90
        while True:
            status = self.command(["docker", "inspect", "--format", "{{.State.Health.Status}}", name],
                                  timeout=30, idle=0).strip()
            if status == "healthy":
                break
            if time.monotonic() > deadline:
                raise RuntimeError(f"PostgreSQL for {platform} did not become healthy ({status})")
            time.sleep(1)
        published = self.command(["docker", "port", name, "5432/tcp"], timeout=30, idle=0).split()[0]
        env["POSTGRES_PORT"] = published.rsplit(":", 1)[1]
        return env

    def memory_database(self, platform, env, log):
        """Serve this environment an in-memory PGlite instead of PostgreSQL, and point `env` at it.

        The launcher (`memory-database.mjs --serve`) is this run's process; cleanup stops it.
        """
        owner = f"{self.directory.name}/{platform}-database"
        self.manifest["ports"].append(owner); self.save()
        port = reserve_port(owner, self.registry_dir)
        with open(log, "ab") as output:
            process = subprocess.Popen(["node", MEMORY_LAUNCHER, "--serve"], cwd=self.root, start_new_session=True,
                                       stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT,
                                       env={**env, "FAMILYFI_MODE": "test", "DB_MODE": "memory",
                                            "POSTGRES_PORT": str(port)})
        self.track_process(process)
        deadline = time.monotonic() + 60
        while True:
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=1):
                    break
            except OSError:
                if process.poll() is not None:
                    raise RuntimeError(f"In-memory database for {platform} exited {process.returncode}; see {log}")
                if time.monotonic() > deadline:
                    raise RuntimeError(f"In-memory database for {platform} did not start; see {log}")
                time.sleep(0.25)
        # Its own settings (scripts/runtime/mode.mjs); the database name is whatever PGlite serves.
        env.update(POSTGRES_PORT=str(port), POSTGRES_USER="postgres", POSTGRES_PASSWORD="postgres",
                   DB_SSL_MODE="disable")
        return env

    def migrate(self, env, **kwargs):
        self.command(["node", "scripts/runtime/with-env.mjs", tool(self.root, "prisma"), "migrate", "deploy"],
                     env=env, timeout=300, idle=120, **kwargs)

    def port(self, platform):
        owner = f"{self.directory.name}/{platform}"
        self.manifest["ports"].append(owner); self.save()
        return reserve_port(owner, self.registry_dir)

    def validate(self):
        m = self.manifest
        if m.get("root") != str(self.root) or m.get("run_id") != self.directory.name:
            raise RuntimeError("Manifest does not belong to this worktree/run")
        if self.directory.parent != (self.root / "build/test-runs").resolve() or not re.fullmatch(r"[a-f0-9]{32}", m["run_id"]):
            raise RuntimeError("Invalid run directory")
        for container in m["containers"]:
            if container["name"] != f"familyfi-test-{m['run_id']}-{container['platform']}":
                raise RuntimeError(f"Foreign container in manifest: {container['name']}")
        for owner in m["ports"]:
            if not owner.startswith(m["run_id"] + "/"):
                raise RuntimeError(f"Foreign port reservation in manifest: {owner}")

    def remove_container(self, name):
        code, output = run(["docker", "inspect", "--format", f'{{{{index .Config.Labels "{LABEL}"}}}}', name],
                           cwd=self.root, env=self.env, timeout=30, idle=0, check=False)
        if code:
            if "no such" in output.lower():
                return
            raise RuntimeError(f"Could not inspect {name}: {output.strip()}")
        if output.strip() != self.directory.name:
            raise RuntimeError(f"Container ownership mismatch: {name} is not labelled for this run")
        self.command(["docker", "rm", "--force", "--volumes", name], timeout=120, idle=0)

    def cleanup(self, platform=None):
        self.validate()
        errors = []
        if not platform:
            for process in list(self.manifest["processes"]):
                if process["identity"] and identity(process["pid"]) == process["identity"]:
                    try:
                        # Playwright stops its detached web server and browsers on SIGTERM; give it time.
                        os.killpg(process["pid"], signal.SIGTERM)
                        deadline = time.monotonic() + 15
                        while time.monotonic() < deadline and identity(process["pid"]) == process["identity"]:
                            time.sleep(0.25)
                        if identity(process["pid"]) == process["identity"]:
                            os.killpg(process["pid"], signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                self.untrack_process(process["pid"])
        for container in list(self.manifest["containers"]):
            if platform and container["platform"] != platform:
                continue
            try:
                self.remove_container(container["name"])
                self.manifest["containers"].remove(container); self.save()
            except Exception as error:
                errors.append(str(error))
        for owner in list(self.manifest["ports"]):
            if platform and owner != f"{self.directory.name}/{platform}":
                continue
            release_port(owner, self.registry_dir)
            self.manifest["ports"].remove(owner); self.save()
        if errors:
            raise RuntimeError("Cleanup failed: " + "; ".join(errors))


def new_run(root=ROOT):
    path = Path(root) / "build/test-runs" / uuid.uuid4().hex
    path.mkdir(parents=True)
    return path
