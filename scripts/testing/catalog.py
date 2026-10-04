"""Discover executable identities and attach explicit feature metadata.

An identity is `<path> > <describe…> > <test>`, the form Vitest prints. Discovery asks the
runners themselves (`vitest list`, `playwright test --list`, unittest), so what is listed is
what executes.
"""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SEP = " > "
LAYERS = ("unit", "integration", "ui")
PLATFORMS = ("host", "desktop", "phone")
VITEST = {"unit": "tests/vitest.config.ts", "integration": "tests/vitest.integration.config.ts"}
PLAYWRIGHT = "tests/playwright.config.ts"
PYTHON_TESTS = "scripts/tests"


def tool(root, name):
    path = Path(root) / "node_modules/.bin" / name
    if not path.exists():
        raise RuntimeError(f"{path.relative_to(root)} is missing: install dependencies first (make setup, or pnpm install)")
    return path


def listing_env():
    # Playwright lists under CI settings, so tests CI leaves out (CI_EXCLUDED_TAGS) are left out
    # here too; its config refuses CI without a recovery password. The integration setup
    # collects without a database while FAMILYFI_TEST_DISCOVERY is set.
    env = {**os.environ, "CI": "1", "FAMILYFI_DEFAULT_PASSWORD": "listing-only",
           "POSTGRES_PASSWORD": "listing-only", "FAMILYFI_TEST_DISCOVERY": "1"}
    env.pop("PLAYWRIGHT_JSON_OUTPUT_FILE", None)
    env.pop("DATABASE_URL", None)
    return env


def runner_json(command, root, env, output_env=None):
    with tempfile.TemporaryDirectory(prefix="test-listing-") as directory:
        target = Path(directory) / "list.json"
        if output_env:
            env = {**env, output_env: str(target)}
        else:
            command = [*command[:-1], f"{command[-1]}={target}"]
        result = subprocess.run(list(map(str, command)), cwd=root, env=env, capture_output=True,
                                text=True, timeout=300, stdin=subprocess.DEVNULL)
        if result.returncode or not target.exists():
            tail = "\n".join((result.stderr or result.stdout).strip().splitlines()[-15:])
            raise ValueError(f"Test discovery failed: {Path(command[0]).name} exited {result.returncode}\n{tail}")
        return json.loads(target.read_text())


def vitest_identities(root, layer):
    found = []
    config = VITEST[layer]
    # Collected by running the files: a static parse leaves `.each` names unexpanded.
    listed = runner_json([tool(root, "vitest"), "list", "--config", config, "--staticParse=false",
                          "--includeTaskLocation", "--json"], root, listing_env())
    for item in listed:
        path = Path(item["file"]).resolve().relative_to(Path(root).resolve()).as_posix()
        found.append({"id": path + SEP + item["name"], "adapter": "vitest", "layer": layer,
                      "platforms": ["host"], "source": path, "line": item.get("location", {}).get("line")})
    return found


def playwright_identities(root):
    listed = runner_json([tool(root, "playwright"), "test", "--list", "--reporter=json", "--config", PLAYWRIGHT],
                         root, listing_env(), output_env="PLAYWRIGHT_JSON_OUTPUT_FILE")
    tests = {}
    def walk(suite, titles, source):
        for spec in suite.get("specs", []):
            identity = source + SEP + SEP.join([*titles, spec["title"]])
            entry = tests.setdefault(identity, {"id": identity, "adapter": "playwright", "layer": "ui",
                                                "platforms": [], "source": source, "line": spec["line"]})
            for test in spec["tests"]:
                if test["projectName"] not in entry["platforms"]:
                    entry["platforms"].append(test["projectName"])
                # Serial tests share state in declaration order: a later one needs the earlier ones.
                if any(a["type"] == "serial" for a in test.get("annotations", [])):
                    entry["serial"] = SEP.join([source, *titles])
        for child in suite.get("suites", []):
            walk(child, [*titles, child["title"]], source)
    for suite in listed.get("suites", []):
        walk(suite, [], "tests/browser/" + suite["file"])
    for entry in tests.values():
        unknown = set(entry["platforms"]) - set(PLATFORMS)
        if unknown:
            raise ValueError(f"Playwright project is not a harness platform: {sorted(unknown)}")
        entry["platforms"].sort(key=PLATFORMS.index)
    return list(tests.values())


def python_identities(root):
    directory = Path(root) / PYTHON_TESTS
    if not directory.is_dir():
        return []
    loader = unittest.TestLoader()
    suite = loader.discover(str(directory), pattern="test_*.py", top_level_dir=str(directory))
    if loader.errors:
        raise ValueError("Python discovery failed: " + "\n".join(map(str, loader.errors)))
    def cases(node):
        if isinstance(node, unittest.TestSuite):
            for child in node:
                yield from cases(child)
        else:
            yield node
    found = []
    for case in cases(suite):
        module, cls, method = case.id().rsplit(".", 2)
        source = f"{PYTHON_TESTS}/{module.replace('.', '/')}.py"
        found.append({"id": SEP.join([source, cls, method]), "adapter": "python", "layer": "unit",
                      "platforms": ["host"], "source": source, "line": None})
    return found


def identities(root=ROOT):
    with ThreadPoolExecutor() as pool:
        listings = [pool.submit(vitest_identities, root, "unit"), pool.submit(vitest_identities, root, "integration"),
                    pool.submit(playwright_identities, root)]
        found = [*python_identities(root), *(item for listing in listings for item in listing.result())]
    seen = set()
    for test in found:
        if test["id"] in seen:
            raise ValueError(f"Two tests share one identity; rename one: {test['id']}")
        seen.add(test["id"])
    return found


def matches(identity, selector):
    return identity == selector or identity.startswith(selector + SEP) or (
        selector.endswith("/") and identity.startswith(selector))


def load(root=ROOT, path=None, discovered=None):
    raw = json.loads((path or Path(root) / "scripts/testing/catalog.json").read_text())
    declared = set(raw["categories"])
    tests, used = [], set()
    for index, identity in enumerate(discovered if discovered is not None else identities(root)):
        entry = dict(identity, categories=[], order=index)
        for selector, metadata in raw["entries"].items():
            if matches(identity["id"], selector):
                used.add(selector)
                entry["categories"] = sorted(set(entry["categories"]) | set(metadata["categories"]))
                if metadata.get("postgres"):
                    # Why the test needs PostgreSQL itself; `run --database memory` reports it as not run.
                    entry["postgres"] = metadata["postgres"]
        if not entry["categories"]:
            raise ValueError(f"Uncategorized test: {entry['id']}\n"
                             "Give its file a category in scripts/testing/catalog.json.")
        unknown = set(entry["categories"]) - declared
        if unknown:
            raise ValueError(f"Unknown categories for {entry['id']}: {sorted(unknown)}")
        tests.append(entry)
    stale = set(raw["entries"]) - used
    if stale:
        raise ValueError(f"Catalog selectors name no tests: {sorted(stale)}")
    return tests, raw["categories"]


def values(items):
    return list(dict.fromkeys(part.strip() for item in items or [] for part in item.split(",") if part.strip()))


def short_forms(identity):
    """The identity as written from `tests/`, and from the file name alone."""
    path, _, rest = identity.partition(SEP)
    tail = SEP + rest if rest else ""
    forms = []
    for prefix in ("tests/", "scripts/tests/"):
        if path.startswith(prefix):
            forms.append(path[len(prefix):] + tail)
    forms.append(Path(path).name + tail)
    return forms


def resolve(tests, selector):
    exact = [t for t in tests if matches(t["id"], selector)]
    if exact:
        return exact
    short = [t for t in tests if any(matches(form, selector) for form in short_forms(t["id"]))]
    if len({t["source"] for t in short}) > 1 and not selector.endswith("/"):
        files = sorted({t["source"] for t in short})
        raise ValueError(f"Ambiguous selector: {selector} matches {', '.join(files)}; use the full path")
    if not short:
        raise ValueError(f"Unknown selector: {selector}")
    return short


def select(tests, selectors=(), categories=(), layers=(), platforms=(), exclude_host=False, known_categories=None):
    categories, layers, platforms = values(categories), values(layers), values(platforms)
    known = set(known_categories or {c for t in tests for c in t["categories"]})
    if set(categories) - known:
        raise ValueError(f"Unknown category: {', '.join(sorted(set(categories) - known))}")
    if set(layers) - set(LAYERS):
        raise ValueError(f"Layers must be {', '.join(LAYERS)}")
    resolved = set()
    for selector in selectors:
        resolved.update(t["id"] for t in resolve(tests, selector))
    expanded = []
    for platform in platforms or ["all"]:
        for name in PLATFORMS if platform == "all" else [platform]:
            if name not in PLATFORMS:
                raise ValueError(f"Unknown platform: {name}; use {', '.join(PLATFORMS)} or all")
            if name not in expanded:
                expanded.append(name)
    # Host tests run once in any selection, unless another job already supplies them.
    if "host" not in expanded and not exclude_host:
        expanded.insert(0, "host")
    if exclude_host:
        expanded = [p for p in expanded if p != "host"]
    selected = [t for t in tests if (not selectors or t["id"] in resolved)
                and (not categories or set(t["categories"]) & set(categories))
                and (not layers or t["layer"] in layers)
                and set(t["platforms"]) & set(expanded)]
    if not selected:
        raise ValueError("Selection contains no applicable tests")
    return selected, [p for p in PLATFORMS if p in expanded]
