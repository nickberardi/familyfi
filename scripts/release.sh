#!/usr/bin/env bash
# Publish a release from this machine: what .github/workflows/release.yml does, without the runners.
#
#   scripts/release.sh --tag v0.12.1               # checks and tests, build, push, publish
#   scripts/release.sh --tag v0.12.1 --skip-ci
#   scripts/release.sh --tag v0.12.1 --no-push     # build both architectures, publish nothing
#   scripts/release.sh --tag v0.12.1 --force       # rebuild and push a released tag checked out at HEAD
#
# Options:
#   --tag vX.Y.Z    the release to publish; must start with v, and must not exist on GitHub yet
#   --force         allow a tag that already exists, if it is HEAD: rebuild and push its images,
#                   overwriting them on GHCR, and create the GitHub Release only if it is missing
#   --skip-ci       don't run the checks and tests (ci.yml's verify job, and container.yml) first
#   --no-push       build only: no GHCR login, no push, no GitHub Release
#   --allow-dirty   allow uncommitted changes in the working tree (the build uses them)
#   -h, --help      print this help
#
# Steps, as in release.yml: HEAD must be on origin/main; CI passes; one buildx build for
# linux/amd64 and linux/arm64 pushes ghcr.io/<owner>/familyfi:X.Y.Z, :X.Y and :latest (the
# last two only for a tag without a pre-release `-`); then a GitHub Release with generated
# notes, which creates the tag on GitHub at HEAD, marked a pre-release below 1.0. The
# architecture this machine isn't is built under emulation, which takes a while.
#
# Creating the tag starts release.yml, which finds this version's images on GHCR and skips.
#
# GHCR credentials: GHCR_TOKEN from the environment or a gitignored .release.env, otherwise
# `gh auth token`, which needs the write:packages scope (gh auth refresh -s write:packages).
# The login lives in a temporary Docker config that is removed on exit. See scripts/README.md.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

tag="" run_ci=1 push=1 allow_dirty=0 force=0
while (($#)); do
  case "$1" in
    --tag) tag="${2:-}"; shift 2 ;;
    --skip-ci) run_ci=0; shift ;;
    --no-push) push=0; shift ;;
    --allow-dirty) allow_dirty=1; shift ;;
    --force) force=1; shift ;;
    -h|--help) awk 'NR > 1 && !/^#/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$0"; exit 0 ;;
    *) echo "unknown argument $1" >&2; exit 2 ;;
  esac
done

die() { echo "release: $*" >&2; exit 1; }

[[ -n "$tag" ]] || { echo "release: --tag is required" >&2; exit 2; }
[[ "$tag" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)(-[0-9A-Za-z.-]+)?$ ]] ||
  die "$tag is not vMAJOR.MINOR.PATCH[-PRERELEASE] (release.yml triggers on v*)"
major="${BASH_REMATCH[1]}" minor="${BASH_REMATCH[2]}" prerelease="${BASH_REMATCH[4]}"
version="${tag#v}"

if [[ -f .release.env ]]; then
  set -a; source .release.env; set +a
fi

# The on-main job in release.yml.
git fetch --quiet origin main
git merge-base --is-ancestor HEAD origin/main || die "HEAD is not on origin/main"
if ((!allow_dirty)) && [[ -n "$(git status --porcelain)" ]]; then
  die "working tree is dirty (commit, stash, or pass --allow-dirty)"
fi
# A lightweight tag lists its commit; an annotated one also lists the commit it peels to, last.
remote_commit=$(git ls-remote origin "refs/tags/$tag" "refs/tags/$tag^{}" | tail -n 1 | cut -f 1)
if [[ -n "$remote_commit" ]]; then
  ((force)) || die "$tag already exists on GitHub (pass --force to rebuild it)"
  [[ "$remote_commit" == "$(git rev-parse HEAD)" ]] ||
    die "$tag on GitHub is $remote_commit, not HEAD (git switch --detach $tag)"
fi
if git rev-parse --verify --quiet "refs/tags/$tag" >/dev/null; then
  [[ "$(git rev-parse "$tag^{commit}")" == "$(git rev-parse HEAD)" ]] || die "local tag $tag is not HEAD"
fi

repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner) || die "gh could not read this repository (gh auth login)"
image="ghcr.io/$(tr '[:upper:]' '[:lower:]' <<<"$repo")"
sha=$(git rev-parse HEAD)

# ci.yml's verify job and container.yml, through the same harness. ci.yml's browser job and
# the OpenAPI checks are not repeated here.
if ((run_ci)); then
  npx --yes "pnpm@$(node -p 'require("./package.json").packageManager.split("@")[1]')" install --frozen-lockfile
  scripts/test.py check audit lint typecheck api db-drift db-upgrade catalog container
  scripts/test.py run --platform host --coverage
  scripts/test.py run --platform host --layer unit --timezone Pacific/Kiritimati
  scripts/test.py build
fi

# A private Docker config, so the GHCR login and the builder never outlive this run. It
# keeps the current context and CLI plugins, and none of the stored credentials.
docker_config=$(mktemp -d)
builder="familyfi-release-$$"
cleanup() {
  DOCKER_CONFIG="$docker_config" docker buildx rm --force "$builder" >/dev/null 2>&1 || true
  rm -rf "$docker_config"
}
trap cleanup EXIT
trap 'exit 130' INT TERM
home_config="${DOCKER_CONFIG:-$HOME/.docker}"
for dir in contexts cli-plugins; do
  [[ -e "$home_config/$dir" ]] && ln -s "$home_config/$dir" "$docker_config/$dir"
done
node -e '
  const fs = require("fs");
  const [from, to] = process.argv.slice(1);
  let config = {};
  try { config = JSON.parse(fs.readFileSync(from, "utf8")); } catch {}
  const kept = {};
  if (config.currentContext) kept.currentContext = config.currentContext;
  if (config.cliPluginsExtraDirs) kept.cliPluginsExtraDirs = config.cliPluginsExtraDirs;
  fs.writeFileSync(to, JSON.stringify(kept));
' "$home_config/config.json" "$docker_config/config.json"
export DOCKER_CONFIG="$docker_config"

if ((push)); then
  token="${GHCR_TOKEN:-}"
  if [[ -z "$token" ]]; then
    gh auth status 2>&1 | grep -q "write:packages" ||
      die "gh's token lacks write:packages: run gh auth refresh -s write:packages, or set GHCR_TOKEN"
    token=$(gh auth token)
  fi
  user=$(gh api user --jq .login)
  printf '%s' "$token" | docker login ghcr.io --username "$user" --password-stdin >/dev/null
  unset token
fi

# The ghcr and manifest jobs, as one multi-platform build.
tags=(--tag "$image:$version")
if [[ -z "$prerelease" ]]; then
  tags+=(--tag "$image:$major.$minor" --tag "$image:latest")
fi
if ((push)); then output=(--push); else output=(--output type=cacheonly); fi
docker buildx create --name "$builder" --driver docker-container >/dev/null
echo "==> build ${tags[*]//--tag /}"
docker buildx build --builder "$builder" --file docker/Dockerfile \
  --platform linux/amd64,linux/arm64 \
  --label "org.opencontainers.image.source=https://github.com/$repo" \
  --label "org.opencontainers.image.version=$version" \
  --label "org.opencontainers.image.revision=$sha" \
  "${tags[@]}" "${output[@]}" .

if ((!push)); then
  echo "built $tag for linux/amd64 and linux/arm64; nothing pushed or published (--no-push)"
  exit 0
fi

# The GitHub Release step. Creating it creates the tag at HEAD.
if ((force)) && gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
  echo "published $image:$version; GitHub Release $tag already exists and is unchanged"
  exit 0
fi
echo "==> GitHub Release $tag"
# Below 1.0 every release is a pre-release (docs/operations.md, Releases), as is a tag with a `-`.
flags=()
if [[ "$major" == 0 || -n "$prerelease" ]]; then flags+=(--prerelease); fi
gh release create "$tag" --repo "$repo" --target "$sha" --title "$tag" ${flags[@]+"${flags[@]}"} --generate-notes --notes "$(cat <<EOF
Image: \`ghcr.io/$repo:$version\` (linux/amd64 and linux/arm64).

Licensed under the Business Source License 1.1. See LICENSE and docs/licensing.md.
EOF
)"
git fetch --quiet origin "refs/tags/$tag:refs/tags/$tag"
echo "published $tag: $image:$version"
