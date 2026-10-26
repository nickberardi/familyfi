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

# The standalone build carries what the server loads; the build's compilers stay out (#283).
if grep -E '(^|/)node_modules/\.pnpm/@next\+swc-' "$tmp/files"; then
  echo "image contains Next.js's build compilers; runtime-deps installs only the Prisma CLI and PGlite" >&2
  exit 1
fi

# Nor what the server never loads (#291): musl binaries Debian cannot run, TypeScript, and the
# PGlite that only `prisma dev` uses beside the one the app does.
if grep -E '(^|/)node_modules/\.pnpm/(@img\+sharp-[^/]*linuxmusl|@node-rs\+argon2-[^/]*musl|typescript@|@electric-sql\+pglite-(socket|tools)@)' "$tmp/files"; then
  echo "image contains packages the server never loads; see runtime-deps and outputFileTracingExcludes" >&2
  exit 1
fi
if [ "$(grep -oE '(^|/)node_modules/\.pnpm/@electric-sql\+pglite@[^/]+/' "$tmp/files" | sort -u | wc -l)" -gt 1 ]; then
  echo "image contains more than one PGlite" >&2
  exit 1
fi

echo "image hygiene ok"
