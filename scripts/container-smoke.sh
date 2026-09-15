#!/bin/sh
# Fresh-container smoke: special-character DB password, health, login, persist restart.
set -eu

image="${FAMILYFI_IMAGE:-familyfi:ci}"
network="familyfi-smoke-$$"
db="familyfi-smoke-db-$$"
app="familyfi-smoke-app-$$"
password='p@ss/w:rd'
admin_password="ci-recovery-password"
session_secret="ci-only-session-secret-32chars!!"
encryption_key="000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
host_port="${SMOKE_PORT:-7011}"

cleanup() {
  docker rm -f "$app" "$db" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$network" >/dev/null
docker run -d --name "$db" --network "$network" \
  -e POSTGRES_USER=familyfi \
  -e POSTGRES_PASSWORD="$password" \
  -e POSTGRES_DB=familyfi \
  postgres:18-alpine >/dev/null

i=0
until docker exec "$db" pg_isready -U familyfi -d familyfi >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "postgres did not become ready" >&2
    exit 1
  fi
  sleep 1
done

run_app() {
  docker run -d --name "$app" --network "$network" -p "${host_port}:7001" \
    -e NODE_ENV=production \
    -e DEFAULT_PASSWORD="$admin_password" \
    -e SESSION_SECRET="$session_secret" \
    -e APP_ENCRYPTION_KEY="$encryption_key" \
    -e DB_MODE=external \
    -e DB_HOST="$db" \
    -e DB_PORT=5432 \
    -e DB_NAME=familyfi \
    -e DB_USER=familyfi \
    -e DB_PASSWORD="$password" \
    "$image" >/dev/null
}

run_app

ok=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
  if curl -sf "http://127.0.0.1:${host_port}/api/v1/health" | grep -q '"status":"ok"'; then
    ok=1
    break
  fi
  sleep 2
done
if [ "$ok" -ne 1 ]; then
  echo "health check failed" >&2
  docker logs "$app" >&2 || true
  exit 1
fi

login="$(curl -sf -D - -o /tmp/familyfi-smoke-login.json -X POST "http://127.0.0.1:${host_port}/api/v1/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"${admin_password}\",\"client\":\"browser\"}")"
echo "$login" | grep -qi 'familyfi_session' || {
  echo "login did not set a session cookie" >&2
  cat /tmp/familyfi-smoke-login.json >&2 || true
  exit 1
}

docker rm -f "$app" >/dev/null
run_app
ok=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if curl -sf "http://127.0.0.1:${host_port}/api/v1/health" | grep -q '"status":"ok"'; then
    ok=1
    break
  fi
  sleep 2
done
if [ "$ok" -ne 1 ]; then
  echo "health check after restart failed" >&2
  docker logs "$app" >&2 || true
  exit 1
fi

echo "container smoke ok"
