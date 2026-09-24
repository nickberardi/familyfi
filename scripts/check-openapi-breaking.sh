#!/bin/sh
# Fails when openapi/familyfi.v1.yaml makes a breaking change against the base branch.
# Whether a breaking change ships is the operator's decision (AGENTS.md, OpenAPI
# consumer coordination): BREAKING_API_APPROVED=true, which CI sets from the pull
# request's `breaking_api` label, records that decision and lets the change through.
set -eu

OASDIFF_VERSION=v1.32.1
spec=openapi/familyfi.v1.yaml
base_ref="${BASE_REF:-main}"
work="${RUNNER_TEMP:-$(mktemp -d)}"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"

git fetch --quiet --depth=1 origin "$base_ref"
if git diff --quiet FETCH_HEAD -- "$spec"; then
  echo "$spec is unchanged from $base_ref."
  exit 0
fi
git show "FETCH_HEAD:$spec" > "$work/base-openapi.yaml"

{
  echo "### OpenAPI changed"
  echo
  echo "Open an issue in \`familyfi-ios\` for the iOS client to adopt this contract change."
} >> "$summary"
echo "$spec changed: open an issue in familyfi-ios for the iOS client to adopt it."

# Built from the Go module proxy, whose checksum database verifies the pinned version.
GOBIN="$work/bin" GOTOOLCHAIN=auto go install "github.com/oasdiff/oasdiff@$OASDIFF_VERSION"

if "$work/bin/oasdiff" breaking "$work/base-openapi.yaml" "$spec" --fail-on ERR; then
  echo "No breaking changes against $base_ref."
  exit 0
fi
if [ "${BREAKING_API_APPROVED:-false}" = "true" ]; then
  echo "The breaking changes above are approved by the breaking_api label."
  echo "Breaking changes approved by the \`breaking_api\` label." >> "$summary"
  exit 0
fi
echo "Breaking changes against $base_ref (above). The operator decides whether they ship:" >&2
echo "add the breaking_api label to approve them, or make the change compatible." >&2
exit 1
