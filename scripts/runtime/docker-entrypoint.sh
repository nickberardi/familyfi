#!/bin/sh
set -eu

DATA_DIR="/var/lib/familyfi/data"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R familyfi:familyfi "$DATA_DIR"
  exec gosu familyfi "$0" "$@"
fi

cd /app
node scripts/runtime/validate-env.mjs

# Demo mode brings its own in-memory database and applies the migrations itself.
if node scripts/runtime/memory-database.mjs --requested; then
  exec node scripts/runtime/memory-database.mjs node scripts/runtime/with-env.mjs node server.js
fi

DATABASE_URL="$(node scripts/runtime/print-database-url.mjs)"
export DATABASE_URL

i=0
until node scripts/runtime/wait-for-db.mjs; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "database was not reachable after 60s" >&2
    exit 1
  fi
  sleep 2
done

./node_modules/.bin/prisma migrate deploy
export SKIP_DB_PREPARE=1
exec node scripts/runtime/with-env.mjs node server.js
