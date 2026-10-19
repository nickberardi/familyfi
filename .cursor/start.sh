#!/usr/bin/env bash
# Per-boot services: Docker, the development PostgreSQL, and Next.js on port 3000.
set -euo pipefail

export PATH="/usr/local/bin:${PATH}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

if ! sudo docker info >/dev/null 2>&1; then
  sudo service docker start >/dev/null 2>&1 || true
fi
if ! sudo docker info >/dev/null 2>&1; then
  sudo mkdir -p /var/run /var/lib/docker
  sudo nohup dockerd >/tmp/dockerd.log 2>&1 &
fi
for _ in $(seq 1 60); do
  if sudo docker info >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
sudo docker info >/dev/null

python3 - <<'PY'
import re
import secrets
from pathlib import Path

path = Path(".env")
text = path.read_text() if path.exists() else Path(".env.example").read_text()

def current(key: str) -> str:
    match = re.search(rf"^{re.escape(key)}=(.*)$", text, re.M)
    return match.group(1).strip() if match else ""

def set_key(body: str, key: str, value: str) -> str:
    line = f"{key}={value}"
    if re.search(rf"^{re.escape(key)}=", body, re.M):
        return re.sub(rf"^{re.escape(key)}=.*$", line, body, count=1, flags=re.M)
    return body.rstrip() + f"\n{line}\n"

if not current("FAMILYFI_MODE"):
    text = set_key(text, "FAMILYFI_MODE", "dev")
if not current("POSTGRES_PASSWORD"):
    text = set_key(text, "POSTGRES_PASSWORD", secrets.token_hex(24))
if not text.endswith("\n"):
    text += "\n"
path.write_text(text)
PY

node scripts/runtime/validate-env.mjs

sudo docker compose -p familyfi --env-file .env -f docker/docker-compose.dev-db.yml up -d --wait

SESSION="familyfi-dev"
if tmux has-session -t "${SESSION}" 2>/dev/null; then
  if curl -fsS -o /dev/null --max-time 3 http://127.0.0.1:3000; then
    exit 0
  fi
  tmux kill-session -t "${SESSION}"
fi

tmux new-session -d -s "${SESSION}" -c "${ROOT}" -- env PATH="/usr/local/bin:${PATH}" KILL_PORT=1 pnpm dev

for _ in $(seq 1 90); do
  if curl -fsS -o /dev/null --max-time 3 http://127.0.0.1:3000; then
    exit 0
  fi
  sleep 2
done

echo "FamilyFi did not answer on http://127.0.0.1:3000" >&2
tmux capture-pane -pt "${SESSION}" >&2 || true
exit 1
