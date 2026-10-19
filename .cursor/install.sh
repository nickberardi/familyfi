#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for FamilyFi. Runs from the repository root.
set -euo pipefail

export PATH="/usr/local/bin:${PATH}"
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
NODE_VERSION="26.12.0"
PNPM_VERSION="10.15.1"

if ! /usr/local/bin/node -v 2>/dev/null | grep -qx "v${NODE_VERSION}"; then
  tmp="$(mktemp)"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" -o "${tmp}"
  sudo tar -xJf "${tmp}" -C /usr/local --strip-components=1 --no-same-owner
  rm -f "${tmp}"
fi

hash -r
if ! /usr/local/bin/pnpm -v 2>/dev/null | grep -qx "${PNPM_VERSION}"; then
  sudo env PATH="/usr/local/bin:${PATH}" npm install -g "pnpm@${PNPM_VERSION}"
fi

if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y --no-install-recommends ca-certificates curl gnupg
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${VERSION_CODENAME}") stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin fuse-overlayfs iptables
fi

if ! dpkg -s fuse-overlayfs >/dev/null 2>&1 || ! dpkg -s iptables >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y --no-install-recommends -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold fuse-overlayfs iptables
fi

sudo mkdir -p /etc/docker
if ! sudo grep -q '"storage-driver": "fuse-overlayfs"' /etc/docker/daemon.json 2>/dev/null; then
  printf '%s\n' '{' '  "storage-driver": "fuse-overlayfs"' '}' | sudo tee /etc/docker/daemon.json >/dev/null
fi

if [ -x /usr/sbin/iptables-legacy ]; then
  sudo update-alternatives --set iptables /usr/sbin/iptables-legacy
fi
if [ -x /usr/sbin/ip6tables-legacy ]; then
  sudo update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy
fi

sudo groupadd -f docker
sudo usermod -aG docker ubuntu

if ! command -v tmux >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y --no-install-recommends -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold tmux
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

pnpm install --frozen-lockfile
sudo env PATH="/usr/local/bin:${PATH}" pnpm exec playwright install-deps chromium
pnpm exec playwright install chromium

git config core.hooksPath .githooks
