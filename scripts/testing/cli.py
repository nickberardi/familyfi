"""Public commands. Read-only discovery never starts containers or servers."""
import argparse
import json
import os
import re
import signal
import sys
import time

from . import catalog, planning
from .checks import CHECKS, run_check
from .engine import build, execute
from .reporting import Report, atomic_json
from .resources import Resources, active, lock, new_run, preflight

ROOT = catalog.ROOT
EPILOG = """examples:
  scripts/test.py run tests/unit/schedule.test.ts
  scripts/test.py run "schedule.test.ts > schedule windows across time zones"
  scripts/test.py run --category schedules
  scripts/test.py run --platform host --layer unit
  scripts/test.py run --layer ui --platform phone
  scripts/test.py run --platform host --coverage
  scripts/test.py run --layer integration --database memory
  scripts/test.py list --category trust
  scripts/test.py check lint typecheck api
  scripts/test.py status; scripts/test.py follow <run-id>; scripts/test.py cleanup <run-id>
"""


def parser():
    tool = argparse.ArgumentParser(prog="scripts/test.py", epilog=EPILOG,
                                   formatter_class=argparse.RawDescriptionHelpFormatter,
                                   description="One test and validation interface. Every run owns fresh databases and servers.")
    commands = tool.add_subparsers(dest="command", required=True)
    for name in ("run", "list"):
        command = commands.add_parser(name, help="Execute selected tests" if name == "run" else "Discover tests and categories")
        command.add_argument("selectors", nargs="*", help='Identity or prefix: a path, "file > describe", or a test; '
                                                           "tests/ and the directory may be left off when unambiguous")
        command.add_argument("--category", action="append", default=[], help="Feature categories; comma-separated or repeatable")
        command.add_argument("--layer", action="append", default=[], help="unit,integration,ui")
        command.add_argument("--platform", action="append", default=[], help="host,desktop,phone,all (default all)")
        command.add_argument("--exclude-host", action="store_true", help="Omit host tests already covered by another CI job")
        if name == "run":
            command.add_argument("--plan", action="store_true", help="Print the execution plan without creating resources")
            command.add_argument("--coverage", action="store_true",
                                 help="Measure unit and integration coverage against its floors (whole host suite only)")
            command.add_argument("--timezone", help="TZ of the test processes, e.g. Pacific/Kiritimati")
            command.add_argument("--database", choices=("postgres", "memory"), default="postgres",
                                 help="postgres (default, as CI runs) or memory: an in-memory PGlite, no Docker; "
                                      "tests that need PostgreSQL itself are reported as not run")
            command.add_argument("--show-browser", action="store_true", help="Run Playwright headed")
            limits(command)
    check = commands.add_parser("check", help="Run repository checks with structured results")
    check.add_argument("checks", nargs="+", choices=CHECKS)
    check.add_argument("--run-id", help="Completed coverage run for the coverage check")
    check.add_argument("--base", default="origin/main", help="Base ref for coverage and OpenAPI checks (default origin/main); nothing is fetched")
    limits(check)
    build_command = commands.add_parser("build", help="Production build, without running tests")
    limits(build_command)
    commands.add_parser("status", help="List runs and their status")
    for name in ("follow", "cleanup"):
        command = commands.add_parser(name, help="Stream a run's events" if name == "follow" else "Remove an interrupted run's resources")
        command.add_argument("run_id")
    return tool


def limits(command):
    command.add_argument("--timeout", type=int, default=2400, help="Wall-clock limit per command, in seconds")
    command.add_argument("--idle", type=int, default=180, help="Command inactivity limit, in seconds")


def run_path(run_id):
    if not re.fullmatch(r"[a-f0-9]{32}", run_id):
        raise ValueError("Run ID must be the 32-character ID printed by the harness")
    path = ROOT / "build/test-runs" / run_id
    if path.is_symlink() or not path.is_dir():
        raise ValueError("Run does not exist in this worktree")
    return path


def checks(args, resources, report):
    shared = {}
    def database():
        if "env" not in shared:
            env = resources.test_env("checks")
            resources.database("checks", env)
            resources.migrate(env, log=report.directory / "migrate.log")
            shared["env"] = env
        return shared["env"]
    for name in args.checks:
        try:
            detail = run_check(name, args, resources, report, run_path, database)
            report.result(name, "passed", role="check", detail=detail)
        except KeyboardInterrupt:
            raise
        except Exception as error:
            report.result(name, "failed", role="check", detail=str(error))


def mutate(args, plan=None, lookup=None):
    with lock(ROOT) as holder:
        directory = new_run(ROOT)
        holder.seek(0); holder.truncate(); holder.write(directory.name); holder.flush()
        resources = Resources(directory, ROOT)
        report = Report(directory, directory.name)
        atomic_json(directory / "plan.json", plan or {"command": args.command, "arguments": vars(args)})
        if os.environ.get("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a") as handle:
                handle.write(f"run_id={directory.name}\n")
        report.emit(f"Run {directory.name}: {directory}")
        def interrupted(signum, _):
            raise KeyboardInterrupt(f"Signal {signum}")
        previous = {sig: signal.signal(sig, interrupted) for sig in (signal.SIGINT, signal.SIGTERM)}
        try:
            if args.command == "run":
                execute(plan, resources, report, args, lookup)
            elif args.command == "check":
                checks(args, resources, report)
            else:
                try:
                    preflight(ROOT)
                    build(resources, report, resources.test_env("build"), args)
                    report.result("build", "passed", role="build")
                except Exception as error:
                    report.result("build", "failed", role="build", detail=str(error))
        except KeyboardInterrupt as error:
            report.cancel_remaining(plan)
            report.result("invocation", "cancelled", role="infrastructure", detail=str(error) or "Interrupted")
        except Exception as error:
            report.result("invocation", "infrastructure-error", role="infrastructure", detail=str(error))
        finally:
            # A second Ctrl-C must not interrupt cleanup.
            for sig in previous:
                signal.signal(sig, signal.SIG_IGN)
            try:
                resources.cleanup()
            except Exception as error:
                report.result("cleanup", "infrastructure-error", role="infrastructure", detail=str(error))
            resources.manifest["complete"] = True
            resources.save()
            for sig, handler in previous.items():
                signal.signal(sig, handler)
        extra = {"coverage": str(directory / "coverage")} if (directory / "coverage/lcov.info").exists() else None
        return report.finish(ROOT / ".next", extra)


def follow(directory):
    offset = 0
    while True:
        events = directory / "events.jsonl"
        if events.exists():
            with events.open("rb") as handle:
                handle.seek(offset)
                for line in handle:
                    if not line.endswith(b"\n"):
                        break
                    event = json.loads(line)
                    if event.get("echo", True):
                        print(event["message"], flush=True)
                    offset += len(line)
        manifest = json.loads((directory / "manifest.json").read_text())
        if not active(manifest):
            result = directory / "results.json"
            return 0 if result.exists() and json.loads(result.read_text()).get("status") == "passed" else 1
        time.sleep(0.25)


def main(argv=None):
    tool = parser()
    args = tool.parse_args(argv)
    try:
        if args.command in ("list", "run"):
            if args.command == "run" and not any((args.selectors, args.category, args.layer, args.platform)):
                tool.error("run requires a test, category, layer, or platform selection")
            tests, categories = catalog.load(ROOT)
            filters = dict(selectors=args.selectors, exclude_host=args.exclude_host, categories=args.category,
                           layers=args.layer, platforms=args.platform, known_categories=categories)
            if args.command == "list":
                selected, _ = catalog.select(tests, **filters)
                print("Categories: " + ", ".join(categories))
                for test in selected:
                    print(f"{test['id']} | {','.join(test['categories'])} | {test['layer']} | "
                          f"{','.join(test['platforms'])} | serial: {test.get('serial') or 'no'}")
                return 0
            if args.coverage and args.database == "memory":
                tool.error("--coverage measures the whole suite, which needs PostgreSQL; drop --database memory")
            resolved = planning.plan(tests, coverage=args.coverage, **filters)
            if args.plan:
                print(json.dumps(resolved, indent=2)); return 0
            return mutate(args, resolved, {t["id"]: t for t in tests})
        if args.command in ("check", "build"):
            return mutate(args)
        if args.command == "status":
            for path in sorted((ROOT / "build/test-runs").glob("*/manifest.json"), key=lambda p: p.stat().st_mtime):
                manifest = json.loads(path.read_text())
                result = path.parent / "results.json"
                outcome = json.loads(result.read_text()).get("status", "running") if result.exists() else "running"
                state = "active" if active(manifest) else "complete" if manifest.get("complete") else "interrupted"
                print(f"{manifest['run_id']} {state} {outcome if state == 'complete' else ''}".rstrip())
            return 0
        directory = run_path(args.run_id)
        if args.command == "cleanup":
            with lock(ROOT):
                manifest = json.loads((directory / "manifest.json").read_text())
                if active(manifest):
                    raise ValueError("Refusing to clean an active run")
                resources = Resources(directory, ROOT, manifest)
                resources.cleanup()
                resources.manifest["complete"] = True; resources.save()
                print(f"Cleaned {args.run_id}")
            return 0
        return follow(directory)
    except Exception as error:
        print(f"test: {error}", file=sys.stderr)
        return 2
