#!/usr/bin/env bash
# Run the CI workflows' jobs on this machine, with the same commands in the same order.
#
#   scripts/ci.sh                          # verify, browser, container and both OpenAPI checks
#   scripts/ci.sh --quick                  # verify and container (what release.sh runs)
#   scripts/ci.sh --only verify browser    # just these jobs
#   scripts/ci.sh --skip openapi-breaking
#   scripts/ci.sh --only mutation          # the weekly mutation run; takes hours
#
# Options:
#   --quick         run verify and container
#   --only JOB...   run only the named jobs
#   --skip JOB...   leave the named jobs out
#   --base REF      what the changed-line coverage and OpenAPI checks compare against
#                   (default: origin/main); nothing is fetched
#   --breaking-api  approve breaking OpenAPI changes, as the breaking_api label does in CI
#   --keep-going    run every job even after one fails, then report all failures
#   -h, --help      print this help
#
# Jobs: verify browser container openapi-version openapi-breaking mutation
#   verify, browser      .github/workflows/ci.yml
#   container            .github/workflows/container.yml
#   openapi-version      .github/workflows/openapi.yml, version (CI runs it when openapi/ changes)
#   openapi-breaking     .github/workflows/openapi.yml, breaking (needs Go)
#   mutation             .github/workflows/mutation.yml; not run unless named with --only
# Not mirrored: codeql.yml (needs the CodeQL CLI) and the runner-cleanup step, which wipes
# Docker and caches the way a CI runner should and this machine should not.
#
# Each job that needs PostgreSQL gets a disposable postgres:18-alpine container on a free loopback
# port, with the credentials ci.yml uses, removed when the job ends or the script exits. The
# development database is never touched. Values in .env still fill any variable CI leaves
# unset (with-env.mjs reads it). Logs go to build/ci/<job>.log. See scripts/README.md.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

ALL_JOBS=(verify browser container openapi-version openapi-breaking)
QUICK_JOBS=(verify container)
KNOWN_JOBS=" verify browser container openapi-version openapi-breaking mutation "
PNPM_VERSION=10.15.1
POSTGRES_IMAGE=postgres:18-alpine

jobs=("${ALL_JOBS[@]}")
skip=()
base=origin/main
keep_going=0
mode=""

while (($#)); do
  case "$1" in
    --quick) jobs=("${QUICK_JOBS[@]}"); shift ;;
    --only) mode=only; jobs=(); shift ;;
    --skip) mode=skip; shift ;;
    --base) base="$2"; shift 2 ;;
    --breaking-api) export BREAKING_API_APPROVED=true; shift ;;
    --keep-going) keep_going=1; shift ;;
    -h|--help) awk 'NR > 1 && !/^#/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$0"; exit 0 ;;
    -*) echo "unknown option $1" >&2; exit 2 ;;
    *)
      case "$mode" in
        only) jobs+=("$1") ;;
        skip) skip+=("$1") ;;
        *) echo "unexpected argument $1 (use --only or --skip)" >&2; exit 2 ;;
      esac
      shift ;;
  esac
done

for job in "${jobs[@]}" ${skip[@]+"${skip[@]}"}; do
  [[ "$KNOWN_JOBS" == *" $job "* ]] || { echo "unknown job $job" >&2; exit 2; }
done
((${#jobs[@]})) || { echo "no jobs to run" >&2; exit 2; }

# The pnpm ci.yml pins, whether or not this machine has it.
if [[ "$(pnpm --version 2>/dev/null || true)" == "$PNPM_VERSION" ]]; then
  pnpm=(pnpm)
else
  pnpm=(npx --yes "pnpm@$PNPM_VERSION")
fi

# ci.yml's job environment: test-only secrets and the database its postgres service offers.
export FAMILYFI_DEFAULT_PASSWORD=ci-recovery-password
export FAMILYFI_SESSION_SECRET='ci-only-session-secret-32chars!!'
export FAMILYFI_ENCRYPTION_KEY=000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
export DB_MODE=external DB_HOST=127.0.0.1 POSTGRES_DB=familyfi_test
export POSTGRES_USER=familyfi POSTGRES_PASSWORD=familyfi-ci

LOGS=build/ci
mkdir -p "$LOGS"
results=()
failed=0

# Every database container this run starts carries this prefix, so the exit trap finds the
# ones a job started even though the job ran in a subshell.
DB_PREFIX="familyfi-ci-$$-"
cleanup() {
  local ids
  ids=$(docker ps -aq --filter "name=^${DB_PREFIX}" 2>/dev/null || true)
  [[ -z "$ids" ]] || docker rm -f $ids >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

free_port() {
  node -e 'const s = require("net").createServer().listen(0, "127.0.0.1", () => { console.log(s.address().port); s.close(); })'
}

# Start this job's PostgreSQL, as ci.yml's `services: postgres` does, and point the job at it.
db_up() {
  local name="${DB_PREFIX}$1" port i
  port=$(free_port)
  docker run -d --name "$name" -p "127.0.0.1:${port}:5432" \
    -e POSTGRES_USER="$POSTGRES_USER" -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" -e POSTGRES_DB="$POSTGRES_DB" \
    --health-cmd "pg_isready -U $POSTGRES_USER -d $POSTGRES_DB" --health-interval 2s \
    --health-timeout 5s --health-retries 30 "$POSTGRES_IMAGE" >/dev/null
  for ((i = 0; i < 60; i++)); do
    [[ "$(docker inspect -f '{{.State.Health.Status}}' "$name")" == healthy ]] && break
    sleep 1
  done
  [[ "$(docker inspect -f '{{.State.Health.Status}}' "$name")" == healthy ]] ||
    { echo "PostgreSQL for $1 did not become healthy" >&2; return 1; }
  export POSTGRES_PORT="$port"
  echo "PostgreSQL for $1 on 127.0.0.1:$port"
}

db_down() { docker rm -f "${DB_PREFIX}$1" >/dev/null 2>&1 || true; }

migrate() { node scripts/runtime/with-env.mjs ./node_modules/.bin/prisma migrate deploy; }

has_diff() {
  git rev-parse --verify --quiet "$base" >/dev/null && [[ -n "$(git diff --name-only "$base"...HEAD)" ]]
}

job_verify() {
  db_up verify
  "${pnpm[@]}" install --frozen-lockfile
  "${pnpm[@]}" audit --prod --audit-level=high
  "${pnpm[@]}" lint
  "${pnpm[@]}" typecheck
  "${pnpm[@]}" test-api
  migrate
  "${pnpm[@]}" db-drift
  "${pnpm[@]}" db-upgrade
  "${pnpm[@]}" test:coverage
  TZ=Pacific/Kiritimati "${pnpm[@]}" test
  # CI runs this on pull requests; here, whenever HEAD differs from the base.
  if has_diff; then
    node scripts/ci/changed-line-coverage.mjs "$base"
  else
    echo "changed-line coverage: no diff against $base, skipped"
  fi
  "${pnpm[@]}" build
  db_down verify
}

job_browser() {
  db_up browser
  "${pnpm[@]}" install --frozen-lockfile
  migrate
  "${pnpm[@]}" build
  if [[ "$(uname -s)" == Linux ]]; then
    "${pnpm[@]}" exec playwright install chromium --with-deps
  else
    "${pnpm[@]}" exec playwright install chromium
  fi
  CI=1 PLAYWRIGHT_PORT="${PLAYWRIGHT_PORT:-3100}" UNIFI_MOCK=1 \
    CLOUDFLARED_BIN="$PWD/tests/fixtures/cloudflared/cloudflared" "${pnpm[@]}" test:browser
  db_down browser
}

job_container() {
  docker build -f docker/Dockerfile -t familyfi:ci .
  sh scripts/ci/check-image.sh familyfi:ci
  FAMILYFI_IMAGE=familyfi:ci sh scripts/ci/container-smoke.sh
}

job_openapi-version() {
  "${pnpm[@]}" install --frozen-lockfile --ignore-scripts
  node scripts/ci/check-openapi-version.mjs "$base"
}

job_openapi-breaking() {
  command -v go >/dev/null || { echo "openapi-breaking needs Go (brew install go)" >&2; return 1; }
  sh scripts/ci/check-openapi-breaking.sh "$base"
}

job_mutation() {
  db_up mutation
  "${pnpm[@]}" install --frozen-lockfile
  "${pnpm[@]}" test:mutation
  node scripts/ci/mutation-summary.mjs
  db_down mutation
}

for job in "${jobs[@]}"; do
  if [[ " ${skip[*]:-} " == *" $job "* ]]; then
    results+=("$job|skipped|-|-"); continue
  fi
  if ((failed && !keep_going)); then
    results+=("$job|not run|-|-"); continue
  fi
  log="$LOGS/$job.log"
  echo "==> $job (log: $log)"
  start=$SECONDS
  # Not inside `if`: that would disable errexit in the job and hide failing steps.
  set +e
  (set -eo pipefail; "job_$job") 2>&1 | tee "$log"
  rc=${PIPESTATUS[0]}
  set -e
  db_down "$job"
  if ((rc == 0)); then status=pass; else status=FAIL; failed=1; fi
  results+=("$job|$status|$((SECONDS - start))s|$log")
done

echo
printf '%-17s %-8s %-7s %s\n' JOB RESULT TIME LOG
for row in "${results[@]}"; do
  IFS='|' read -r j s t l <<<"$row"
  printf '%-17s %-8s %-7s %s\n' "$j" "$s" "$t" "$l"
done
exit "$failed"
