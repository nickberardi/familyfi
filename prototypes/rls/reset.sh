#!/usr/bin/env bash
# Recreates the prototype database: the real migrations as the owner, then setup.sql.
set -euo pipefail
cd "$(dirname "$0")/../.."
psql -h 127.0.0.1 -p "${PGPORT:-55440}" -U owner -d postgres -qc "DROP DATABASE IF EXISTS familyfi" -c "CREATE DATABASE familyfi"
DB_HOST=127.0.0.1 POSTGRES_PORT="${PGPORT:-55440}" POSTGRES_USER=owner POSTGRES_PASSWORD=x POSTGRES_DB=familyfi \
  pnpm exec prisma migrate deploy >/dev/null
psql -h 127.0.0.1 -p "${PGPORT:-55440}" -U owner -d familyfi -v ON_ERROR_STOP=1 -1 -qf prototypes/rls/setup.sql
