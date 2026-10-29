#!/bin/sh
# Runs the pinned oasdiff release, downloading it once per machine and checking it against the
# SHA-256 recorded here, so no job compiles it or needs Go.
#
# Usage: sh scripts/ci/oasdiff.sh <oasdiff arguments>
set -eu

OASDIFF_VERSION=1.32.1
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) asset=linux_amd64 sha=7c8939fc49b75ee11fec66a5b83b37a2fca6aee109fed85013b1ba2ac2a1ee7f ;;
  Linux-aarch64 | Linux-arm64) asset=linux_arm64 sha=32fff58a120f75a723d6c2422444691c37fa6813fed61d23f53dbcb604b30f6d ;;
  Darwin-*) asset=darwin_all sha=e4d74b7e2dfb9d4819e7fc720c905ec86547e4637ac270a2b0187c0f1fb7187e ;;
  *) echo "oasdiff.sh: no pinned oasdiff release for $(uname -s) $(uname -m)" >&2; exit 1 ;;
esac

dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/familyfi-oasdiff-$OASDIFF_VERSION"
bin="$dir/oasdiff"
if [ ! -x "$bin" ]; then
  mkdir -p "$dir"
  archive="$dir/oasdiff_${OASDIFF_VERSION}_$asset.tar.gz"
  curl -fsSL --retry 3 -o "$archive" \
    "https://github.com/oasdiff/oasdiff/releases/download/v$OASDIFF_VERSION/oasdiff_${OASDIFF_VERSION}_$asset.tar.gz"
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$archive" | cut -d' ' -f1)"
  else
    actual="$(shasum -a 256 "$archive" | cut -d' ' -f1)"
  fi
  if [ "$actual" != "$sha" ]; then
    rm -f "$archive"
    echo "oasdiff.sh: $archive has SHA-256 $actual, expected $sha" >&2
    exit 1
  fi
  tar -xzf "$archive" -C "$dir" oasdiff
  rm -f "$archive"
fi
exec "$bin" "$@"
