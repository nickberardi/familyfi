#!/bin/sh
# Restores a FamilyFi database dump (a pre-update backup, or an export's database.dump) over the
# database FamilyFi uses, with FamilyFi stopped (docs/operations.md, Backup and restore).
#
#   restore-database.sh <file.dump>
#   restore-database.sh - < database.dump
#
# The dump replaces the database whole. Restoring into the existing tables instead
# (`pg_restore --clean`) leaves behind every table a newer release added and puts back the dump's
# older migration history, so the next start's migrations fail on tables that already exist. Here
# the schema is emptied and the dump loaded in one transaction: a dump that fails to load changes
# nothing, and the next start migrates the restored database forward like any upgrade.
#
# Connects with DATABASE_URL when it is set, otherwise with FamilyFi's own database settings.
set -eu

fail() {
  echo "restore: $1" >&2
  exit 1
}

[ "$#" -eq 1 ] || fail "usage: restore-database.sh <file.dump>, or - to read the dump from standard input"
source="$1"
name="$1"
[ "$name" = "-" ] && name="the dump from standard input"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT INT TERM
if [ "$source" = "-" ]; then
  # Read twice (checked, then loaded), so standard input is kept first.
  cat > "$work/restore.dump"
  source="$work/restore.dump"
fi
[ -r "$source" ] || fail "can't read $source"
pg_restore --list "$source" > /dev/null 2>&1 || fail "$source is not a PostgreSQL dump (pg_dump --format=custom)"

if [ -z "${DATABASE_URL:-}" ]; then
  runtime="$(dirname "$0")"
  # An in-memory database (the demo, or DB_MODE=memory) is gone after any restart; nothing to restore into.
  if node "$runtime/memory-database.mjs" --requested; then
    fail "the database is in memory; there is nothing to restore into"
  fi
  DATABASE_URL="$(node "$runtime/print-database-url.mjs")" || fail "could not read the database settings"
  # The password goes in the environment, not the command line any process can list.
  PGPASSWORD="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.argv[1]).password))' "$DATABASE_URL")" || fail "could not read the database settings"
  export PGPASSWORD
  DATABASE_URL="$(node -e 'const url = new URL(process.argv[1]); url.password = ""; process.stdout.write(url.toString())' "$DATABASE_URL")" || fail "could not read the database settings"
fi

# A running FamilyFi would keep writing to the database it is about to lose.
others="$(psql "$DATABASE_URL" --no-psqlrc --tuples-only --no-align --command \
  "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()")" \
  || fail "could not connect to the database"
[ "$others" = "0" ] || fail "$others other connection(s) to the database; stop FamilyFi first"

# Written out whole before anything runs: a dump that stops partway must not be loaded as far as it got.
{
  echo "SET client_min_messages = warning;"
  echo "DROP SCHEMA IF EXISTS public CASCADE;"
  echo "CREATE SCHEMA public;"
} > "$work/restore.sql"
pg_restore --no-owner --no-privileges --file - "$source" >> "$work/restore.sql" || fail "could not read $source"
psql "$DATABASE_URL" --no-psqlrc --quiet --single-transaction --set ON_ERROR_STOP=1 --file "$work/restore.sql" > /dev/null \
  || fail "the dump did not load; the database is unchanged"

echo "restore: restored $name. Start FamilyFi; it brings the database up to its release on start."
