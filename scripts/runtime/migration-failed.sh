#!/bin/sh
# What docker-entrypoint.sh prints when `prisma migrate deploy` fails, below Prisma's own error:
# which migration failed, and the steps back to the release that was running, from the backup the
# updater took before installing this one (pre-update-backup.sh). Every start fails the same way
# until then, so the log is the one place the operator can read it. docs/operations.md, "When an
# update fails", has the same steps. When no migration is recorded as failed, the database itself
# was the problem, and there is nothing to roll back.
#
#   migration-failed.sh [backup directory]
set -u

backups="${1:-/var/lib/familyfi/data/backups}"
image="ghcr.io/nickberardi/familyfi"
version="$(node -p 'require(require("node:path").resolve(process.argv[1])).version' "$(dirname "$0")/../../package.json" 2>/dev/null)" \
  || version="this release"
# The password goes in the environment, not the command line any process can list, and an
# unreachable database answers within seconds.
PGPASSWORD="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.argv[1]).password))' "${DATABASE_URL:-}" 2>/dev/null)" || PGPASSWORD=""
url="$(node -e 'const url = new URL(process.argv[1]); url.password = ""; process.stdout.write(url.toString())' "${DATABASE_URL:-}" 2>/dev/null)" || url=""
export PGPASSWORD
migration="$(PGCONNECT_TIMEOUT=5 psql "$url" --no-psqlrc --tuples-only --no-align --command \
  "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL ORDER BY started_at DESC LIMIT 1" \
  2>/dev/null)" || migration=""
# The newest backup, by modification time, as the updater keeps them, unless this release wrote
# it: then it was taken before an earlier update, not this one.
backup="$(ls -1t "$backups"/familyfi-v*.dump 2>/dev/null | head -n 1)"
case "$(basename "${backup:-none}")" in "familyfi-v$version-"*) backup="" ;; esac

line="================================================================================"
echo "$line"
echo "FamilyFi $version could not update its database, so it has not started."
if [ -z "$migration" ]; then
  # Not a migration that failed (the database refused the connection, say): nothing to roll back.
  echo "Prisma's error is above. If restarting doesn't help, see \"When an update fails\" in"
  echo "https://github.com/nickberardi/familyfi/blob/main/docs/operations.md"
  echo "$line"
  exit 0
fi
echo "The step that failed is $migration; Prisma's error is above."
echo "The gateway keeps the rules it already has while FamilyFi is stopped."
echo
if [ -n "$backup" ]; then
  previous="$(basename "$backup" | sed -n 's/^familyfi-v\(.*\)-[0-9]\{8\}T[0-9]\{6\}Z\.dump$/\1/p')"
  taken="$(basename "$backup" | sed -n 's/^.*-\([0-9]\{4\}\)\([0-9]\{2\}\)\([0-9]\{2\}\)T\([0-9]\{2\}\)\([0-9]\{2\}\)[0-9]\{2\}Z\.dump$/\1-\2-\3 \4:\5 UTC/p')"
  echo "The newest backup was taken${taken:+ $taken}. If that was before this update, go back to the"
  echo "release you were running, from the folder with your docker-compose.yml:"
  echo "  1. docker compose stop app"
  echo "  2. docker compose run --rm --no-deps -T --entrypoint /app/scripts/runtime/restore-database.sh app $backup"
  # Releases are published by digest; each one's notes name its image (release.yml). A local tag
  # GHCR doesn't have keeps Watchtower from installing anything until it is set back.
  echo "  3. docker pull $image@sha256:<digest>, with the image named in the notes of"
  if [ -n "$previous" ]; then
    echo "     https://github.com/nickberardi/familyfi/releases/tag/v$previous"
  else
    echo "     the release you were running (https://github.com/nickberardi/familyfi/releases)"
  fi
  echo "  4. docker tag $image@sha256:<digest> $image:rollback"
  echo "  5. Set FAMILYFI_UPDATE_TAG=rollback in .env"
  echo "  6. docker compose up -d app"
  echo "Step 5 also holds back automatic updates. Set it back to latest or next once a release fixes this."
else
  echo "No backup from before this update is in $backups. Restore your own backup of the"
  echo "database, then run the release it came from (\"When an update fails\" in docs/operations.md)."
fi
echo "Please report this at https://github.com/nickberardi/familyfi/issues with the log above."
echo "$line"
