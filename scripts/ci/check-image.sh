#!/bin/sh
set -eu

image="${1:-familyfi:ci}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cid="$(docker create "$image")"
docker export "$cid" | tar -t > "$tmp/files"
docker rm "$cid" >/dev/null

if grep -E '(^|/)\.env$|(^|/)designs(/|$)' "$tmp/files"; then
  echo "image contains designs/ or a baked .env" >&2
  exit 1
fi

if ! grep -q 'openapi/familyfi.v1.yaml' "$tmp/files"; then
  echo "image is missing openapi/familyfi.v1.yaml" >&2
  exit 1
fi

if grep -E '^/?app/scripts/ci/' "$tmp/files"; then
  echo "image contains CI scripts; only scripts/runtime/ belongs in it" >&2
  exit 1
fi

if ! grep -qE '^/?app/scripts/runtime/with-env.mjs$' "$tmp/files"; then
  echo "image is missing scripts/runtime/" >&2
  exit 1
fi

echo "image hygiene ok"
