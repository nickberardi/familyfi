#!/bin/sh
# Watchtower's pre-update hook (the app's labels in docker/docker-compose.yml): back up the database
# before Watchtower replaces this container with a newer release, whose start applies its migrations.
# Exit 75 tells Watchtower to skip the update, so FamilyFi keeps running the release it has; any other
# failure would abort Watchtower's whole update instead. Keeps the newest KEEP dumps.
set -u

BACKUP_DIR="/var/lib/familyfi/data/backups"
KEEP=3

fail() {
  echo "pre-update backup: $1; skipping the update" >&2
  exit 75
}

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$BACKUP_DIR" || fail "could not create $BACKUP_DIR"
  chown familyfi:familyfi "$BACKUP_DIR" || fail "could not hand $BACKUP_DIR to familyfi"
  exec gosu familyfi "$0" "$@"
fi

cd /app || fail "/app is missing"

# An in-memory database (the demo, or DB_MODE=memory) is gone after any restart; nothing to keep.
if node scripts/runtime/memory-database.mjs --requested; then
  echo "pre-update backup: the database is in memory; nothing to back up"
  exit 0
fi

DATABASE_URL="$(node scripts/runtime/print-database-url.mjs)" || fail "could not read the database settings"
# The password goes in the environment, not the command line any process can list.
PGPASSWORD="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.argv[1]).password))' "$DATABASE_URL")" || fail "could not read the database settings"
export PGPASSWORD
DATABASE_URL="$(node -e 'const url = new URL(process.argv[1]); url.password = ""; process.stdout.write(url.toString())' "$DATABASE_URL")" || fail "could not read the database settings"
version="$(node -p 'require("/app/package.json").version')" || fail "could not read the running version"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/familyfi-v$version-$stamp.dump"

mkdir -p "$BACKUP_DIR" || fail "could not create $BACKUP_DIR"
# Written beside its final name and moved into place, so a partial dump never looks like a backup.
pg_dump --format=custom --no-owner --file "$target.partial" "$DATABASE_URL" || {
  rm -f "$target.partial"
  fail "pg_dump failed"
}
mv "$target.partial" "$target" || fail "could not keep $target"
echo "pre-update backup: wrote $target"

# Newest first by modification time; drop all but the newest KEEP.
ls -1t "$BACKUP_DIR"/familyfi-v*.dump 2>/dev/null | tail -n "+$((KEEP + 1))" | while read -r old; do
  rm -f "$old"
done
exit 0
