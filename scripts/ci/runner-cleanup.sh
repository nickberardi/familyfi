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

# Docker: builders left by jobs that died before setup-buildx-action's post step, then
# unused images, stopped containers, networks, anonymous volumes and build cache. The
# job's own service containers are running, so they and their images stay.
if command -v docker >/dev/null 2>&1; then
  docker buildx rm --all-inactive --force >/dev/null 2>&1 || true
  docker builder prune --all --force >/dev/null || true
  docker system prune --all --force --volumes >/dev/null || true
fi

# pnpm's store only grows; setup-node restores it from the Actions cache on every install.
rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/pnpm/store"

# Go build and module caches from installing oasdiff, including GOTOOLCHAIN=auto toolchains.
# Module files are read-only, so make them writable before removing them.
for dir in "$HOME/.cache/go-build" "${GOPATH:-$HOME/go}/pkg/mod"; do
  if [ -d "$dir" ]; then
    chmod -R u+w "$dir" 2>/dev/null || true
    rm -rf "$dir"
  fi
done

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
