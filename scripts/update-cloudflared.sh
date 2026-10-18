#!/bin/sh
# Pin docker/Dockerfile to a cloudflared release: its version and the SHA-256 of both Linux
# binaries the image downloads. The sidecar example in docs/setup.md follows the same
# version. With no argument it takes Cloudflare's latest release.
# Each hash is computed from the download and must also appear in the release notes, so a
# bad download or a swapped asset fails rather than being pinned. Reading the notes and
# finding the latest release need `gh`; given a version without `gh`, the notes check is
# skipped with a warning, except under CI, where it fails. Prints the version it pinned. .github/workflows/cloudflared.yml
# runs it twice a month and opens a PR when the pin changes.
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
dockerfile="$root/docker/Dockerfile"
setup="$root/docs/setup.md"
repo="cloudflare/cloudflared"

version="${1:-}"
if [ -z "$version" ]; then
  version="$(gh release view --repo "$repo" --json tagName --jq .tagName)"
fi
case "$version" in
  *[!0-9.]* | "") echo "not a cloudflared version: $version" >&2; exit 2 ;;
esac

notes=""
if command -v gh >/dev/null 2>&1 && notes="$(gh release view "$version" --repo "$repo" --json body --jq .body 2>/dev/null)"; then
  :
else
  notes=""
  if [ -n "${CI:-}" ]; then
    echo "could not read the $version release notes to check the hashes against" >&2
    exit 1
  fi
  echo "warning: could not read the $version release notes, so the hashes are not checked against them" >&2
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Check both downloads before touching a tracked file, then edit copies and move them into
# place only once every line has changed, so a failure leaves the worktree as it was.
for arch in amd64 arm64; do
  curl -fsSL --retry 3 -o "$tmp/$arch" "https://github.com/$repo/releases/download/$version/cloudflared-linux-$arch"
  sum="$(sha256sum "$tmp/$arch" | cut -d' ' -f1)"
  if [ -n "$notes" ] && ! printf '%s\n' "$notes" | grep -qiF "cloudflared-linux-$arch: $sum"; then
    echo "cloudflared-linux-$arch $version hashes to $sum, which its release notes do not list" >&2
    exit 1
  fi
  echo "$sum" > "$tmp/$arch.sum"
done

sed -E "s/^ARG CLOUDFLARED_VERSION=.*/ARG CLOUDFLARED_VERSION=$version/" "$dockerfile" > "$tmp/Dockerfile"
grep -q "^ARG CLOUDFLARED_VERSION=$version\$" "$tmp/Dockerfile" || { echo "no CLOUDFLARED_VERSION to change in $dockerfile" >&2; exit 1; }
for arch in amd64 arm64; do
  sum="$(cat "$tmp/$arch.sum")"
  sed -i -E "s/^(    $arch\) sum=)[0-9a-f]{64}( ;;)/\1$sum\2/" "$tmp/Dockerfile"
  grep -q "$arch) sum=$sum ;;" "$tmp/Dockerfile" || { echo "no $arch hash line to change in $dockerfile" >&2; exit 1; }
done
sed -E "s#cloudflare/cloudflared:[0-9.]+#cloudflare/cloudflared:$version#" "$setup" > "$tmp/setup.md"
cat "$tmp/Dockerfile" > "$dockerfile"
cat "$tmp/setup.md" > "$setup"
echo "$version"
