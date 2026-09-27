---
name: validate-change
description: Validate a FamilyFi change before handoff or reproduce a CI failure using the project's existing checks.
---

# Validate a change

Work from the repository root. Follow [AGENTS.md](../../../AGENTS.md); use [testing.md](../../../docs/testing.md) to select checks and [scripts/README.md](../../../scripts/README.md#cish) for local CI options.

## Select the evidence

- Identify the requested scope: working changes, a branch against its base, or a failing CI job. Inspect staged, unstaged and relevant untracked files as well as committed changes. State the base ref used; do not assume a missing or stale `origin/main` is a valid comparison.
- Map the changed behaviour to the validation table in `testing.md`. Start with focused tests when reproducing a failure; complete the applicable handoff checks afterward. Documentation-only work follows its own row.
- For database-backed CI reproduction, prefer the existing disposable jobs in `scripts/ci.sh`. Read `scripts/ci.sh --help` for job selection. `--quick` covers only verify and container; add the applicable browser and contract jobs. It is not the complete suite.
- Check prerequisites for the selected jobs and disk space before builds. Do not run `make setup` or migrate a household database just to obtain test infrastructure. Avoid overlapping runs in one checkout: builds, coverage and `build/ci` logs share paths.

## Run and interpret

- Run the selected commands and retain their exit status and useful failure evidence. For CI failures, reproduce the failing job's inputs and environment; distinguish a product failure from unavailable infrastructure. Fix failures within the requested scope, then rerun affected checks.
- After coverage, run `node scripts/ci/changed-line-coverage.mjs <base-ref>` when applicable. The CI wrapper decides whether to run it from committed differences, so it can skip working-tree-only changes. The helper includes tracked working changes but Git does not include untracked files; state that limitation rather than reporting complete changed-line coverage for them. Do not stage or commit work solely to hide that limitation.
- Follow the existing rules on regression tests, exemptions and bypasses. Passing a retry, changing an expected value or skipping a job is not evidence that the original failure is fixed. If a required check remains unavailable, report what is still unverified.
- For UI work, include the rendered desktop and phone checks required by the development conventions. Local mocks establish application behaviour; hardware enforcement needs separate operator-requested verification.

## Finish

Review the diff once more for unintended changes from generators or test setup. Clean task-owned disposable resources under the resource rules in `AGENTS.md`; never use runner cleanup locally. Preserve logs needed for an unresolved failure and report their location.

Report the scope/base, commands and results, unresolved failures or unrun checks, and any retained artifacts in the conversation or requested PR. Keep task reports out of project documentation.
