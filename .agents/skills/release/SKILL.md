---
name: release
description: Prepare or publish a FamilyFi release when the operator requests release work.
---

# Release FamilyFi

Work from the repository root. Read [release operations](../../../docs/operations.md#releases) and the [release script reference](../../../scripts/README.md#releasesh). Follow [AGENTS.md](../../../AGENTS.md) for permissions, compatibility and resource ownership.

## Establish the target

- Determine whether the request is preparation, a local build check or publication. Preparation and build checks do not authorize publication. An existing explicit publication request is sufficient; do not ask for the same permission again.
- Identify the intended repository, commit and release version from the request and checkout. Compare the tag's version with `package.json` and OpenAPI `info.version`; stop on a mismatch instead of changing versions to fit. Inspect working-tree changes and refresh the relevant remote ref before checking ancestry. The script accepts an ancestor of `origin/main`, so verify it is the intended release commit.
- Check whether the tag, GitHub Release or versioned GHCR image already exists. An existing image may represent a partial publication; its presence is not evidence that validation passed. Do not overwrite it or rerun publication blindly.
- Verify required tools and credential availability without printing secrets. Use the script's existing authentication path. Check disk space before builds and preserve unrelated work; a dirty checkout is not a reason to discard or stash someone else's changes.

## Prepare and validate

Use the applicable checks in [testing.md](../../../docs/testing.md). The local release script runs the checks and tests of `ci.yml`'s verify job and `container.yml` through `scripts/test.py` itself; account for the browser tests (`run --layer ui`) and OpenAPI checks separately. Keep checks tied to the intended commit. Use `scripts/release.sh --help` for current options and keep the normal checks enabled under the repository's bypass rules.

Prepare the release notes, including whether a block was checked on a real gateway, as operations requires. A release request alone does not authorize live UniFi experiments; when policy writes changed, raise the missing hardware evidence with the operator.

For preparation only, report the target, evidence and remaining steps. If a build check is requested, `scripts/release.sh --tag <tag> --no-push` runs a real multi-platform build, not a cheap preview; it uses cache-only output and leaves no loadable release image. It still needs the script's GitHub access and other prerequisites.

## Publish and verify

- Immediately before a publishing command, confirm that publication of this target is covered by the user's request and that applicable checks succeeded. If authorization is missing, finish preparation and present the concrete target and evidence for approval.
- Use the requested release path from operations. For local publication use `scripts/release.sh --tag <tag>`; for a tag-triggered release use the documented workflow. Keep one publication path. Neither path deploys the release to a household.
- If publication fails after any external write, inspect the tag, images and release to determine what completed. Report the partial state. Do not delete published artifacts, replace tags or repeat image pushes without a recovery decision from the operator.
- Verify the remote tag resolves to the intended commit, the image manifest contains both supported architectures, and the GitHub Release has the expected version and prerelease status. Complete the prepared verification notes while preserving generated notes. For the Actions path, check the workflow result; for local publication, account for the workflow's expected existing-image skip.

Report the release URL, tag, commit, image reference, validation and any unresolved publication steps. Clean only task-owned disposable output under `AGENTS.md`; report artifacts retained for review. Keep the report in the conversation.
