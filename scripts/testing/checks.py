"""Repository checks. Each calls the same helper or package script the workflows call."""
import json
import os
import shutil

from . import catalog
from .resources import pnpm, preflight

CHECKS = ("lint", "typecheck", "api", "api-version", "api-breaking", "audit", "db-drift", "db-upgrade",
          "catalog", "coverage", "container", "mutation")
NEEDS_DATABASE = {"db-drift", "db-upgrade", "mutation"}
DOCKER = NEEDS_DATABASE | {"container"}


def summary_file():
    return [os.environ["GITHUB_STEP_SUMMARY"]] if os.environ.get("GITHUB_STEP_SUMMARY") else []


def commands(name, args, root):
    package = pnpm(root)
    return {
        "lint": [[*package, "lint"]],
        "typecheck": [[*package, "typecheck"]],
        "api": [[*package, "test-api"]],
        "api-version": [["node", "scripts/ci/check-openapi-version.mjs", args.base]],
        "api-breaking": [["sh", "scripts/ci/check-openapi-breaking.sh", args.base]],
        # Known high or critical advisories in what ships, not in dev tooling.
        "audit": [[*package, "audit", "--prod", "--audit-level=high"]],
        "db-drift": [[*package, "db-drift"]],
        "db-upgrade": [[*package, "db-upgrade"]],
        "container": [["docker", "build", "-f", "docker/Dockerfile", "-t", "familyfi:ci", "."],
                      ["sh", "scripts/ci/check-image.sh", "familyfi:ci"],
                      ["sh", "scripts/ci/container-smoke.sh"]],
        "mutation": [[*package, "test:mutation"], ["node", "scripts/ci/mutation-summary.mjs", *summary_file()]],
    }[name]


def coverage(args, runs):
    """Changed-line coverage from a completed `run --coverage`, which already held the floors."""
    if not args.run_id:
        raise ValueError("coverage needs --run-id from a `run --platform host --coverage` invocation")
    directory = runs(args.run_id)
    results = json.loads((directory / "results.json").read_text())
    if not results.get("complete") or results["status"] != "passed":
        raise ValueError("Changed-line coverage needs a completed, passing coverage run")
    lcov = directory / "coverage/lcov.info"
    if not lcov.is_file():
        raise ValueError("That run collected no coverage; run with --coverage")
    return [["node", "scripts/ci/changed-line-coverage.mjs", "--lcov", lcov, args.base, *summary_file()]]


def run_check(name, args, resources, report, runs, database):
    if name == "catalog":
        tests, _ = catalog.load(resources.root)
        return f"{len(tests)} categorized tests"
    if name == "api-breaking" and not shutil.which("go"):
        raise RuntimeError("api-breaking needs Go (brew install go)")
    preflight(resources.root, docker=name in DOCKER)
    env = database() if name in NEEDS_DATABASE else resources.test_env("checks")
    if name == "container":
        env = {**env, "FAMILYFI_IMAGE": "familyfi:ci"}
    steps = coverage(args, runs) if name == "coverage" else commands(name, args, resources.root)
    timeout = 5 * 3600 if name == "mutation" else args.timeout
    idle = max(args.idle, {"container": 600, "mutation": 1800}.get(name, 0))
    for command in steps:
        resources.command(command, env=env, timeout=timeout, idle=idle,
                          log=report.directory / f"{name}.log", emit=report.emit, stream=True)
    return ""
