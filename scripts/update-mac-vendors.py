"""Refresh the local MAC registrant lookup from IEEE's public MA-L/M/S listings.

Run deliberately during development; the app never sends household MACs to a lookup service.
Source: https://standards.ieee.org/products-programs/regauth/
"""

import csv
import io
import json
from pathlib import Path
from urllib.request import Request, urlopen


SOURCES = (
    "https://standards-oui.ieee.org/oui/oui.csv",
    "https://standards-oui.ieee.org/oui28/mam.csv",
    "https://standards-oui.ieee.org/oui36/oui36.csv",
)
OUTPUT = Path(__file__).resolve().parents[1] / "src/server/mac-vendors.json"


def main() -> None:
    vendors: dict[str, str] = {}
    for url in SOURCES:
        with urlopen(Request(url, headers={"User-Agent": "curl/8.0"}), timeout=20) as response:
            rows = csv.DictReader(io.TextIOWrapper(response, encoding="utf-8"))
            for row in rows:
                prefix = row["Assignment"].upper()
                vendor = row["Organization Name"].strip()
                if prefix and vendor:
                    vendors[prefix] = vendor
    OUTPUT.write_text(json.dumps(vendors, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")
    print(f"Wrote {len(vendors)} MAC registrants to {OUTPUT}")


if __name__ == "__main__":
    main()
