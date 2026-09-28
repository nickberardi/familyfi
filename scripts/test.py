#!/usr/bin/env python3
"""Shared test and validation entry point; run --help for selections and lifecycle commands."""
import sys

if sys.version_info < (3, 11):
    raise SystemExit("The test harness requires Python 3.11 or newer; select it on PATH or invoke python3.12 scripts/test.py.")

# No __pycache__ in the tree: release.sh refuses a dirty working tree.
sys.dont_write_bytecode = True

from testing.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
