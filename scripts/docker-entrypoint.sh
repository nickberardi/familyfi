#!/bin/sh
set -eu

cd /app
node scripts/validate-env.mjs
DATABASE_URL="$(node scripts/print-database-url.mjs)"
export DATABASE_URL

i=0
until node scripts/wait-for-db.mjs; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "database was not reachable after 60s" >&2
    exit 1
  fi
  sleep 2
done

./node_modules/.bin/prisma migrate deploy
export FAMILYFI_SKIP_DB_PREPARE=1
exec node scripts/with-env.mjs node server.js
