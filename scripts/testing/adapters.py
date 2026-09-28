"""Execution adapters return structured case outcomes, never rendered summary counts."""
import json
from pathlib import Path
import re
import sys

from .catalog import PLAYWRIGHT, SEP, VITEST, tool
from .process import CommandError, run
from .reporting import atomic_json

ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
GOOD = ("passed", "expected-failure")


def clean(text):
    return ANSI.sub("", text or "").strip()


def relative(root, path):
    return Path(path).resolve().relative_to(Path(root).resolve()).as_posix()


def filters(steps, catalog_lookup):
    """Whole files where every test of the file is in the batch, otherwise `file:line`."""
    chosen = {s["test"] for s in steps}
    arguments = []
    for source in dict.fromkeys(s["source"] for s in steps):
        everything = [t for t in catalog_lookup.values() if t["source"] == source and t["adapter"] == steps[0]["adapter"]]
        if all(t["id"] in chosen for t in everything):
            arguments.append(source)
        else:
            arguments.extend(dict.fromkeys(f"{source}:{s['line']}" for s in steps if s["source"] == source))
    return arguments


def vitest_cases(payload, root):
    found, files = {}, {}
    statuses = {"passed": "passed", "failed": "failed", "skipped": "skipped", "pending": "skipped",
                "todo": "skipped", "disabled": "skipped"}
    for result in payload.get("testResults", []):
        source = relative(root, result["name"])
        if result.get("status") == "failed" and result.get("message"):
            files[source] = clean(result["message"])
        for case in result.get("assertionResults", []):
            identity = source + SEP + SEP.join([*case.get("ancestorTitles", []), case["title"]])
            found[identity] = {"test": identity, "status": statuses.get(case["status"], "infrastructure-error"),
                               "detail": clean("\n".join(case.get("failureMessages") or [])),
                               "seconds": round((case.get("duration") or 0) / 1000, 3)}
    return found, files


def playwright_cases(payload, platform):
    found = {}
    def walk(suite, titles, source):
        for spec in suite.get("specs", []):
            identity = source + SEP + SEP.join([*titles, spec["title"]])
            for test in spec["tests"]:
                if test["projectName"] != platform:
                    continue
                results = test.get("results", [])
                errors = [clean(e.get("message", "")) for r in results for e in r.get("errors", [])]
                skip = [a.get("description", "") for a in test.get("annotations", []) if a["type"] == "skip"]
                status = {"expected": "passed", "unexpected": "failed", "flaky": "failed",
                          "skipped": "skipped"}.get(test["status"], "infrastructure-error")
                detail = "\n".join(errors)
                if test["status"] == "expected" and test.get("expectedStatus") == "failed":
                    status = "expected-failure"
                elif test["status"] == "flaky":
                    detail = "Passed only on a retry; a flaky test is a failure\n" + detail
                elif status == "skipped":
                    detail = "; ".join(filter(None, skip))
                found[identity] = {"test": identity, "status": status, "detail": detail.strip(),
                                   "seconds": round(sum(r.get("duration", 0) for r in results) / 1000, 3)}
        for child in suite.get("suites", []):
            walk(child, [*titles, child["title"]], source)
    for suite in payload.get("suites", []):
        walk(suite, [], "tests/browser/" + suite["file"])
    return found, [clean(e.get("message", "")) for e in payload.get("errors", [])]


def finish_cases(steps, actual, file_errors=None, outcomes=None):
    """Hold every selected case to a structured outcome. A skip is never a pass."""
    outcomes = dict(outcomes or {})
    result = {}
    for step in steps:
        identity = step["test"]
        row = dict(actual.get(identity) or {"test": identity, "status": "infrastructure-error",
                                             "detail": "Selected test missing from structured results"})
        if identity not in actual and (file_errors or {}).get(step["source"]):
            row.update(status="failed", detail=file_errors[step["source"]])
        if row["status"] == "skipped":
            if any(outcomes.get(key) not in GOOD for key in step.get("depends_on", [])):
                row.update(status="blocked", detail="An earlier test of its serial group did not pass")
            else:
                row.update(status="failed", detail=("Unexpected skip: " + row.get("detail", "")).strip())
        result[identity] = row
        outcomes[step["key"]] = row["status"]
    if result and all(a.get("status") == "skipped" for a in (actual.get(s["test"], {}) for s in steps)):
        for row in result.values():
            row.update(status="failed", detail="All selected tests skipped; nothing was exercised")
    return result


def unexplained(runner, code, text, cases, error):
    """A runner that exits non-zero has failed, even when every case it reported passed.

    Vitest, for one, sets a failing exit code for an unhandled error that no case records.
    """
    if not code or error or not all(c["status"] in GOOD for c in cases.values()):
        return error
    return f"{runner} exited {code} though every selected test passed:\n" + clean("".join(text.splitlines(True)[-12:]))


def python(resources, report, steps, directory, env, args):
    identifiers = [s["test"] for s in steps]
    selection, records = directory / "host-selection.json", directory / "host-cases.jsonl"
    atomic_json(selection, identifiers)
    error = None
    try:
        code, text = run([sys.executable, Path(__file__).with_name("host.py"), selection, records],
                         cwd=resources.root, env=env, timeout=args.timeout, idle=args.idle,
                         log=directory / "host.log", emit=report.emit, stream=True, owner=resources, check=False)
    except CommandError as failure:
        code, text, error = None, "", str(failure)
    actual = {}
    if records.exists():
        for line in records.read_text().splitlines():
            row = json.loads(line)
            if actual.get(row["test"], {}).get("status") not in (None, "passed"):
                continue  # A failing subtest decides the case.
            actual[row["test"]] = row
    cases = finish_cases(steps, actual)
    return cases, unexplained("unittest", code, text, cases, error)


def vitest(resources, report, steps, directory, env, args, lookup, coverage=None):
    output = directory / "vitest.json"
    if coverage:
        command = [tool(resources.root, "vitest"), "run", "--config", "tests/vitest.coverage.config.ts",
                   "--coverage.enabled=true", f"--coverage.reportsDirectory={coverage}"]
    else:
        command = [tool(resources.root, "vitest"), "run", "--config", VITEST[steps[0]["layer"]],
                   *filters(steps, lookup)]
    command += ["--reporter=default", "--reporter=json", f"--outputFile.json={output}"]
    if env.get("GITHUB_ACTIONS") == "true":
        command.append("--reporter=github-actions")  # Vitest's own default in Actions: inline annotations
    error = None
    try:
        code, text = run(command, cwd=resources.root, env=env, timeout=args.timeout, idle=args.idle,
                         log=directory / "vitest.log", emit=report.emit, stream=True, owner=resources, check=False)
    except CommandError as failure:
        code, text, error = None, "", str(failure)
    if not output.exists():
        return finish_cases(steps, {}), error or f"Vitest wrote no results (exit {code})", None
    actual, file_errors = vitest_cases(json.loads(output.read_text()), resources.root)
    cases = finish_cases(steps, actual, file_errors)
    floors = None
    # Vitest holds the floors only once every test passed, and exits non-zero on a miss.
    if coverage and code is not None and all(c["status"] in GOOD for c in cases.values()):
        missed = "\n".join(clean(line) for line in text.splitlines() if "does not meet" in line and "threshold" in line)
        # A failing exit that names no floor says nothing about them either way.
        floors = missed or (None if code else "")
    return cases, error if floors else unexplained("Vitest", code, text, cases, error), floors


def playwright(resources, report, steps, directory, env, args, lookup, platform):
    output = directory / "playwright.json"
    command = [tool(resources.root, "playwright"), "test", "--config", PLAYWRIGHT, "--project", platform,
               "--reporter=list,json,./tests/browser-ci-guard.ts", "--output", directory / "test-results", *filters(steps, lookup)]
    if args.show_browser:
        command.append("--headed")
    env = {**env, "PLAYWRIGHT_JSON_OUTPUT_FILE": str(output)}
    error = None
    try:
        code, text = run(command, cwd=resources.root, env=env, timeout=args.timeout, idle=args.idle,
                         log=directory / "playwright.log", emit=report.emit, stream=True, owner=resources, check=False)
    except CommandError as failure:
        code, text, error = None, "", str(failure)
    if not output.exists():
        return finish_cases(steps, {}), error or f"Playwright wrote no results (exit {code})"
    actual, errors = playwright_cases(json.loads(output.read_text()), platform)
    if errors:
        error = "; ".join(filter(None, [error, *errors]))
    # Order matters: a serial test's prerequisites are decided before it.
    cases = finish_cases(steps, actual)
    return cases, unexplained("Playwright", code, text, cases, error)
