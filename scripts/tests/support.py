"""Synthetic catalogs and run directories for the harness tests."""
import json
from pathlib import Path
import tempfile

from testing import catalog


def identity(path, *titles, adapter=None, layer=None, platforms=None, line=1, serial=None):
    if adapter is None:
        adapter = "playwright" if path.startswith("tests/browser/") else "python" if path.startswith("scripts/") else "vitest"
    if layer is None:
        layer = {"playwright": "ui"}.get(adapter) or ("integration" if "/integration/" in path else "unit")
    entry = {"id": catalog.SEP.join([path, *titles]), "adapter": adapter, "layer": layer,
             "platforms": platforms or (["desktop", "phone"] if adapter == "playwright" else ["host"]),
             "source": path, "line": line}
    if serial:
        entry["serial"] = serial
    return entry


DISCOVERED = [
    identity("scripts/tests/test_x.py", "XTests", "test_one"),
    identity("tests/integration/reconcile.test.ts", "reconcile", "applies a schedule", line=10),
    identity("tests/integration/reconcile.test.ts", "reconcile", "pauses", line=20),
    identity("tests/unit/schedule.test.ts", "nextTransition", "crosses midnight", line=5),
    identity("tests/unit/schedule.test.ts", "nextTransition", "keeps the zone", line=9),
    identity("tests/unit/sync/schedule.test.ts", "sync schedule", "runs", line=3),
    identity("tests/browser/pair.spec.ts", "publishes a route", platforms=["desktop"], line=10,
             serial="tests/browser/pair.spec.ts"),
    identity("tests/browser/pair.spec.ts", "revokes the route", platforms=["desktop"], line=20,
             serial="tests/browser/pair.spec.ts"),
    identity("tests/browser/pair.spec.ts", "lays out on a phone", platforms=["phone"], line=30,
             serial="tests/browser/pair.spec.ts"),
    identity("tests/browser/mobile-nav.spec.ts", "opens the drawer", platforms=["phone"], line=4),
]

ENTRIES = {
    "scripts/tests/": ["test-infrastructure"],
    "tests/integration/reconcile.test.ts": ["sync"],
    "tests/unit/schedule.test.ts": ["schedules"],
    "tests/unit/schedule.test.ts > nextTransition > keeps the zone": ["display"],
    "tests/unit/sync/schedule.test.ts": ["sync"],
    "tests/browser/pair.spec.ts": ["pairing"],
    "tests/browser/mobile-nav.spec.ts": ["navigation"],
}


def write_catalog(directory, entries=None, categories=None):
    entries = ENTRIES if entries is None else entries
    path = Path(directory) / "catalog.json"
    known = categories or sorted({c for cats in entries.values() for c in cats} | {"accessibility"})
    path.write_text(json.dumps({"version": 1, "categories": known,
                                "entries": {k: {"categories": v} for k, v in entries.items()}}))
    return path


def load(entries=None, discovered=None):
    with tempfile.TemporaryDirectory() as directory:
        return catalog.load(Path(directory), path=write_catalog(directory, entries),
                            discovered=DISCOVERED if discovered is None else discovered)


class Args:
    timeout, idle, timezone, show_browser = 60, 30, None, False
