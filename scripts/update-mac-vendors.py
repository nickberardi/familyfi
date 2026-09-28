"""Refresh the committed MAC registrant database from IEEE's public MA-L/M/S listings.

Run deliberately during development and commit the result; builds never regenerate it and
the app never sends household MACs to a lookup service. The `source` table records each
listing's URL, SHA-256 and row count, and `meta` records when they were downloaded.
Source: https://standards.ieee.org/products-programs/regauth/
"""

import csv
import hashlib
import io
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen


SOURCES = (
    "https://standards-oui.ieee.org/oui/oui.csv",
    "https://standards-oui.ieee.org/oui28/mam.csv",
    "https://standards-oui.ieee.org/oui36/oui36.csv",
)
OUTPUT = Path(__file__).resolve().parents[1] / "src/server/mac-registrants.sqlite"
FORMAT_VERSION = "1"


def main() -> None:
    vendors: dict[str, str] = {}
    sources: list[tuple[str, str, int]] = []
    for url in SOURCES:
        with urlopen(Request(url, headers={"User-Agent": "curl/8.0"}), timeout=60) as response:
            body = response.read()
        rows = 0
        for row in csv.DictReader(io.StringIO(body.decode("utf-8"))):
            prefix = row["Assignment"].strip().upper()
            vendor = row["Organization Name"].strip()
            if prefix and vendor:
                vendors[prefix] = vendor
                rows += 1
        sources.append((url, hashlib.sha256(body).hexdigest(), rows))

    names = sorted(set(vendors.values()))
    name_ids = {name: index for index, name in enumerate(names)}
    temporary = OUTPUT.with_suffix(".sqlite.tmp")
    temporary.unlink(missing_ok=True)
    db = sqlite3.connect(temporary)
    db.executescript(
        """
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
        CREATE TABLE source (url TEXT PRIMARY KEY, sha256 TEXT NOT NULL, rows INTEGER NOT NULL) WITHOUT ROWID;
        CREATE TABLE name (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE registrant (
          prefix TEXT PRIMARY KEY,
          name_id INTEGER NOT NULL REFERENCES name(id)
        ) WITHOUT ROWID;
        """
    )
    db.executemany("INSERT INTO meta VALUES (?, ?)", [
        ("format_version", FORMAT_VERSION),
        ("downloaded_at", datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")),
    ])
    db.executemany("INSERT INTO source VALUES (?, ?, ?)", sources)
    db.executemany("INSERT INTO name VALUES (?, ?)", [(name_ids[name], name) for name in names])
    db.executemany(
        "INSERT INTO registrant VALUES (?, ?)",
        [(prefix, name_ids[vendor]) for prefix, vendor in sorted(vendors.items())],
    )
    db.commit()
    db.execute("VACUUM")
    db.close()
    temporary.replace(OUTPUT)
    print(f"Wrote {len(vendors)} MAC registrants ({len(names)} names) to {OUTPUT}")


if __name__ == "__main__":
    main()
