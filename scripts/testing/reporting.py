"""One event stream and result format for every execution adapter."""
from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import time

BAD = {"failed", "blocked", "cancelled", "infrastructure-error"}


def atomic_json(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def size(path):
    path = Path(path)
    if not path.exists():
        return 0
    return sum(p.stat().st_size for p in path.rglob("*") if p.is_file() and not p.is_symlink())


def human(count):
    for unit in ("B", "KiB", "MiB", "GiB"):
        if count < 1024 or unit == "GiB":
            return f"{count:.0f} {unit}" if unit == "B" else f"{count:.1f} {unit}"
        count /= 1024


class Report:
    def __init__(self, directory, run_id, quiet=False):
        self.directory, self.run_id = Path(directory), run_id
        self.started = time.monotonic()
        self.results = []
        self.quiet = quiet

    def emit(self, message, echo=True, **fields):
        """Record an event; `echo=False` keeps it out of the terminal and `follow`."""
        event = {"time": datetime.now(timezone.utc).isoformat(), "message": message, "echo": echo, **fields}
        with (self.directory / "events.jsonl").open("a") as handle:
            handle.write(json.dumps(event) + "\n")
        if echo and not self.quiet:
            print(message, flush=True)

    def result(self, identity, status, platform="host", role="selected", **details):
        row = {"test": identity, "status": status, "platform": platform, "role": role, **details}
        self.results.append(row)
        # The runner already streamed each pass; a row that needs attention is printed again.
        self.emit(f"{platform:8} {status:20} {identity}", echo=status not in ("passed", "expected-failure"), result=row)
        atomic_json(self.directory / "results.json", {"run_id": self.run_id, "complete": False,
                                                     "results": self.results})
        return row

    def cancel_remaining(self, plan):
        recorded = {row.get("key") for row in self.results}
        for environment in (plan or {}).get("environments", []):
            for step in environment["steps"]:
                if step["key"] not in recorded:
                    self.result(step["test"], "cancelled", environment["platform"], step["role"],
                                key=step["key"], detail="Invocation cancelled")

    def finish(self, cache, extra=None):
        counts = Counter(r["status"] for r in self.results)
        failed = not self.results or any(r["status"] in BAD for r in self.results)
        outcome = {"run_id": self.run_id, "complete": True, "status": "failed" if failed else "passed",
                   "seconds": round(time.monotonic() - self.started, 2), "counts": dict(counts),
                   "results": self.results, "artifacts": str(self.directory),
                   "artifact_bytes": size(self.directory), "cache_bytes": size(cache), **(extra or {})}
        atomic_json(self.directory / "results.json", outcome)
        rows = ["| Platform | Role | Outcome | Count |", "| --- | --- | --- | ---: |"]
        grouped = Counter((r["platform"], r["role"], r["status"]) for r in self.results)
        rows.extend(f"| {p} | {role} | {status} | {count} |" for (p, role, status), count in sorted(grouped.items()))
        summary = f"## Test run {self.run_id}: {outcome['status']}\n\n" + "\n".join(rows)
        summary += (f"\n\nDuration: {outcome['seconds']} s. Artifacts: `{self.directory}` "
                    f"({human(outcome['artifact_bytes'])}). Build cache: `{cache}` ({human(outcome['cache_bytes'])}).\n")
        if not self.results:
            summary += "\n- Nothing ran, so nothing was verified.\n"
        for row in self.results:
            if row["status"] in BAD:
                detail = (row.get("detail") or row["status"]).strip()
                lines = detail.splitlines()
                detail = "\n  ".join(lines[:15] + (["…"] if len(lines) > 15 else []))
                summary += f"\n- **{row['test']}** ({row['platform']}): {detail}\n"
        (self.directory / "summary.md").write_text(summary)
        if os.environ.get("GITHUB_STEP_SUMMARY"):
            with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as handle:
                handle.write(summary)
        self.emit(summary)
        return 1 if failed else 0
