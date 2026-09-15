#!/usr/bin/env bash
# Per-boot startup: bring PostgreSQL back up. Dependencies, role/databases and
# migrations are prepared in install.sh; the next-dev terminal (via
# scripts/with-env.mjs) applies any pending migrations when it launches.
set -euo pipefail
cd "$(dirname "$0")/.."

PG_VERSION="$(ls /etc/postgresql 2>/dev/null | sort -V | tail -1)"
PG_VERSION="${PG_VERSION:-16}"

sudo pg_ctlcluster "$PG_VERSION" main start 2>/dev/null || true
for _ in $(seq 1 30); do
  if sudo -u postgres pg_isready -q; then
    echo "PostgreSQL is ready."
    exit 0
  fi
  sleep 1
done

echo "PostgreSQL did not become ready in time." >&2
exit 1
