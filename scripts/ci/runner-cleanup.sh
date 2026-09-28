#!/bin/sh
# Return a self-hosted runner's disk to its resting state. Every self-hosted job runs it
# right after checkout (.github/actions/runner-cleanup), so a job starts on a clean disk
# whatever the last one left, even if that job crashed. Everything removed here is
# restored from the GitHub Actions cache or downloaded again by the step that needs it.
set -u

# Free space only: job logs are public, and device names and mounts describe the host.
report() {
  df -hP / | awk 'NR > 1 { print "Disk: " $4 " free of " $2 }'
}

report

# Two agents on one machine share Docker and, without per-runner paths, $HOME.
# A sibling job's cleanup must not delete the toolchain that job is compiling with.
runner_root=""
if [ -n "${RUNNER_WORKSPACE:-}" ]; then
  runner_root=$(CDPATH= cd "$(dirname "$(dirname "$RUNNER_WORKSPACE")")" && pwd)
fi
others=0
if command -v pgrep >/dev/null 2>&1; then
  workers=$(pgrep -c -x Runner.Worker 2>/dev/null || true)
  if [ "${workers:-0}" -gt 1 ]; then
    others=1
  fi
fi

# Only this runner's directory. A shared path is removed only when this job is alone.
remove_tree() {
  dir=$1
  [ -n "$dir" ] && [ -d "$dir" ] || return 0
  if [ -n "$runner_root" ]; then
    case "$dir" in
      "$runner_root"/*) ;;
      *) [ "$others" -eq 0 ] || return 0 ;;
    esac
  else
    [ "$others" -eq 0 ] || return 0
  fi
  chmod -R u+w "$dir" 2>/dev/null || true
  rm -rf "$dir"
}

# Docker is one daemon for every agent. Pruning it while another job builds deletes
# that job's cache and its Go-unrelated image layers.
if command -v docker >/dev/null 2>&1 && [ "$others" -eq 0 ]; then
  # Test databases of a job killed before scripts/test.py could remove them; prune skips running containers.
  ids=$(docker ps -aq --filter label=familyfi.test-run 2>/dev/null || true)
  [ -z "$ids" ] || docker rm --force --volumes $ids >/dev/null 2>&1 || true
  docker buildx rm --all-inactive --force >/dev/null 2>&1 || true
  docker builder prune --all --force >/dev/null || true
  docker system prune --all --force --volumes >/dev/null || true
fi

# pnpm's store only grows; setup-node restores it from the Actions cache on every install.
if [ -n "${npm_config_store_dir:-}" ]; then
  remove_tree "$npm_config_store_dir"
else
  [ "$others" -eq 0 ] && rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/pnpm/store"
fi

# Go build and module caches from installing oasdiff, including GOTOOLCHAIN=auto toolchains.
# The toolchain is a directory inside the module cache; deleting a shared one mid-build
# makes compile disappear. Private caches are set on each runner service.
if [ -n "${GOMODCACHE:-}" ]; then
  remove_tree "$GOMODCACHE"
else
  remove_tree "${GOPATH:-$HOME/go}/pkg/mod"
fi
if [ -n "${GOCACHE:-}" ]; then
  remove_tree "$GOCACHE"
else
  remove_tree "$HOME/.cache/go-build"
fi

# Tool downloads (CodeQL bundles, Node versions) not refreshed in two weeks; the setup
# step that still needs one downloads it again.
if [ -n "${RUNNER_TOOL_CACHE:-}" ] && [ -d "$RUNNER_TOOL_CACHE" ]; then
  find "$RUNNER_TOOL_CACHE" -mindepth 2 -maxdepth 2 -type d -mtime +14 -exec rm -rf {} + 2>/dev/null || true
fi

# Packages apt downloaded for `playwright install --with-deps`, when sudo needs no password.
sudo -n apt-get clean >/dev/null 2>&1 || true

# Temp files from the test suite, container smoke and release digests.
find /tmp -maxdepth 1 -user "$(id -u)" \( -name 'familyfi-*' -o -name 'digests' \) -exec rm -rf {} + 2>/dev/null || true

# Runner diagnostics older than a week. RUNNER_WORKSPACE is <runner>/_work/<repository>.
if [ -n "${RUNNER_WORKSPACE:-}" ]; then
  diag="$(dirname "$(dirname "$RUNNER_WORKSPACE")")/_diag"
  [ -d "$diag" ] && find "$diag" -type f -mtime +7 -delete 2>/dev/null
fi

report
