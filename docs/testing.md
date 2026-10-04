# Testing

Run these locally before a pull request; CI runs the same checks, listed at the end. Every test and check runs through one harness, `scripts/test.py`, for people, agents, the pre-push hook and CI alike. The `make` targets below are aliases for it; its selections (one test, a category, a layer, a platform), outputs and run lifecycle are in [scripts/README.md](../scripts/README.md#testpy).

## What to run

The pre-push hook runs lint, typecheck and the unit tests on every push; `make setup` turns it on, and `make hooks` does so in an existing clone. Before you open a pull request, also run the rows your change touches:

| You changed | Run |
| --- | --- |
| Documentation only | Check changed links, paths and commands against the repo; `git diff --check`. For agent instructions, also run `scripts/test.py run tests/unit/invariants.test.ts`. No application build or database is needed. |
| Code, dependencies, configuration or tooling | `make lint typecheck test-coverage` |
| Pages, components or `globals.css` | `make test-browser` |
| An `/api/v1` route or payload | `make test-api` and relevant integration tests. Update `openapi/familyfi.v1.yaml` when HTTP behaviour changes; an internal refactor alone needs no spec edit. For spec changes also run `make test-api-version test-api-breaking` (breaking check needs Go) and coordinate iOS as required in `AGENTS.md`. |
| `prisma/schema.prisma` or a migration | `make db-drift db-upgrade`. `db-drift` migrates a fresh database and compares it with the schema; `db-upgrade` upgrades a filled database from every supported release, so a household that skipped releases is covered. `pnpm db-upgrade --from v0.22.3` or `--latest` runs one start point against the development database while you iterate |

Start with focused tests while iterating (`scripts/test.py list` finds them; `run <file>` or `run --category <name>` runs them); the table is the handoff requirement. The pre-push hook still runs its checks on every push, including documentation changes. If a required check cannot run, report the command, blocker and unverified behaviour. Do not bypass it or claim the change is fully verified. CI remains the merge check.

**Prerequisites:**
- Python 3.11 or newer on `PATH`, for `scripts/test.py`.
- Docker, for integration tests, browser tests and database checks. Each run starts its own PostgreSQL containers and removes them afterwards. Without Docker, `--database memory` runs integration and browser tests on an in-memory PGlite instead; it is a quick local pass, not a substitute for CI. PGlite is one database session that serves one transaction at a time, so it hides concurrency that PostgreSQL shows, and the few tests that need PostgreSQL itself are reported `not-run`.
- Chromium for the browser tests, installed once with `pnpm exec playwright install chromium`.

Tests always use a `familyfi_test` database in the run's own container, or the run's own in-memory PGlite. `resetDatabase` refuses any other database, and the harness never points a test at the development database.

## The suites

| Suite | Needs | Covers |
| --- | --- | --- |
| Unit: `tests/unit`, `tests/contract` | Nothing | Pure logic, plus repository-wide rules: naming, colour contrast, icons, client/server boundary, invariants, repository hygiene, Node version |
| Integration: `tests/integration` | PostgreSQL | Route handlers and reconciliation against a mocked UniFi. Every response is checked against the OpenAPI document; an undocumented status or a body that does not match its schema fails the test |
| Authorization matrix: `tests/integration/authorization-matrix.test.ts` | PostgreSQL | Every `/api/v1` route and method, found on disk, called as anonymous, member, administrator, recovery `admin`, and over the tunnel without a paired phone; each cell must be allowed, 401 or 403 as its table says. A route missing from the table fails it, so a new route declares its access there |
| Browser: `tests/browser` | PostgreSQL, Chromium | Desktop and phone smoke tests on a production build with the UniFi mock, plus axe (WCAG 2.1 A and AA) on every page |
| API contract: `scripts/ci/check-openapi.mjs` | Nothing | Lints the OpenAPI document; every route and method exists on both sides |
| Harness: `scripts/tests` | Python | The test harness itself: selection, planning, result mapping, resource ownership and cleanup |

The authorization matrix runs with the integration suite. When you add a route, add its line to `ACCESS` in that file. An unexpected permission is a finding, not a reason to make the expected value match the implementation. Record ambiguous access with a `question` and raise it. For an authorized access change, update the guard, matrix, contract and negative tests together; apply the API compatibility rules first.

`make test` runs the host platform: unit, integration and harness tests. `make test-coverage` does the same in one coverage pass and fails below a coverage floor. `make test-browser` builds the app and runs Playwright on desktop and phone the way CI does. Anywhere, a skipped test, a test that passed only on a retry, or a selected test with no result fails the run.

## Rules

- **A bug fix ships with a test that fails without it.** Write the test first and watch it fail for the reason in the bug report.
- Assert outcomes and meaningful failure cases. Test a fix through its public boundary when practical; do not mirror its algorithm in the assertion or mock the behaviour being fixed.
- Do not change expected values, delete assertions, broaden mocks, add exclusions or insert suppressions merely to pass. A changed expectation must trace to an intentional behaviour change. Explain any new coverage exemption, CI exclusion or lint/type suppression in the PR and include the remaining risk.
- **Coverage floors only go up.** They live in `tests/vitest.coverage.config.ts`. Raise a floor when you lift an area, and never lower one to pass.
- **A changed line in a security-critical path needs a test.** On a pull request, `scripts/ci/changed-line-coverage.mjs` fails CI when a changed line no test runs is in one of `GATED_PATHS`: `src/server/unifi/**`, `auth.ts`, `guard.ts`, `quarantine.ts`, `src/server/tunnel/**` and `reconciliation.ts`, where a file-wide floor would average a new untested branch away. Elsewhere it lists those lines and the floors decide.
  - A line no test can reach takes `// coverage-exempt: <why>` at its end, or alone on the line above. The reason is required, and the run summary lists every exemption so a reviewer sees it.
  - Run it yourself after `make test-coverage`: `scripts/test.py check coverage --run-id <run-id>`, with the run ID that run printed.
- **Never skip your way to green.** A test that skips fails the run, and so does a browser test that passes only on its retry.
  - Tag a test that belongs to one viewport `@desktop` or `@phone`.
  - A test that cannot run in CI takes a tag from `CI_EXCLUDED_TAGS` in `tests/browser-ci-guard.ts`, with the reason.
  - Never skip, disable or quarantine a failing test.
- **Test data is synthetic.** `tests/unit/repository-hygiene.test.ts` enforces this:
  - MAC addresses in tests are locally administered (for example `02:…`);
  - fixture IPv4 addresses come from the documentation ranges `192.0.2.0/24`, `198.51.100.0/24` and `203.0.113.0/24`;
  - never commit a live UniFi response.
- **The UniFi mock answers like the real API.** `tests/unit/unifi-client-contract.test.ts` runs the cases in `src/server/unifi/contract-cases.ts` against `MockUnifiClient` and `HttpUnifiClient`. Change the mock and those cases together.
- **Display behaviour is shared with iOS through `tests/fixtures/display-vectors.json`.** See [Display vectors](#display-vectors).
- **Every test has a category.** A new test file needs an entry in `scripts/testing/catalog.json`, keyed by its path, so `--category` finds it; every run and `check catalog` fail on an uncategorized test or an entry that names none. Pick existing categories where they fit.
- **Every invariant in AGENTS.md names its tests.** A new invariant comes with them; `tests/unit/invariants.test.ts` fails when one names none or a missing file.
- **Household time never depends on the server's time zone.** CI runs the unit suite a second time at UTC+14 to catch this.

## Display vectors

The native iOS app, [`nickberardi/familyfi-ios`](https://github.com/nickberardi/familyfi-ios), ports the display logic by hand: `src/lib/display.ts`, `groupActionSpecs` in `src/lib/group-actions.ts`, the pause sheet in `src/lib/pause-sheet.ts`, rule actions and state line in `src/lib/rule-actions.ts`, rule windows with the internet state and day bands in `src/lib/rule-windows.ts`. The day timeline and internet zone (`src/lib/day-timeline.ts`, `src/lib/internet-zone.ts`) are covered by unit tests rather than vectors: the Expo app imports them directly instead of porting them. `tests/fixtures/display-vectors.json` is the set of cases both must pass, and iOS replays the same file against its port.

- Each vector is `{ "fn", "name", "input", "expected" }`: call `fn` with the named arguments in `input` and compare to `expected`. Instants are ISO 8601 strings, and a returned instant is compared as its ISO string. The file carries a `version`; bump it when the format changes, not when cases do.
- Inputs are plain JSON and pin everything the output depends on: a vector that needs the time names `now` and `timeZone`, never the wall clock. So a display function takes `now` from its caller rather than defaulting to `new Date()`.
- `tests/unit/display-vectors.test.ts` runs every vector against the TypeScript, and fails when an exported function of those modules has no vector and is not on its commented exclusion list.
- **Changing display behaviour means changing the vectors in the same pull request.** That diff is the iOS team’s signal to update the port, so an `expected` value changes only because the behaviour did, and the pull request says which.

## Mutation testing

Coverage shows which lines ran; it does not show whether a test would notice if one of them were wrong. `make test-mutation` checks that. Stryker makes small deliberate bugs, one at a time: `<` becomes `<=`, a condition becomes `true`, `enabled: false` becomes `enabled: true`. It runs the tests that cover each one. A bug no test notices **survives**, and names a behaviour nothing checks.

- **Scope.** It covers the code that decides what a gateway enforces: reconciliation, policy planning, policy ownership, quarantine and schedules. The list is `mutate` in `tests/stryker.config.mjs`.
- **When it runs.** In CI it runs weekly, when `src/` or `tests/` changed that week. You can also run it by hand from the Actions tab or with `make test-mutation`.
- **Not a gate.** It never fails a build. Read the survivors in the HTML report, `reports/mutation/index.html`, or the `mutation-report` artifact in CI. Fix a survivor with a test when it hides a real gap. Leave it when the change makes no observable difference, such as a log message.
- **A workaround.** `scripts/ci/stryker-vitest-names.mjs` fixes a mismatch between Stryker 10 and Vitest 5. Without it no test runs and every mutant survives. The script says when to delete it.

## What CI runs

The workflows that run tests call `scripts/test.py`, so a local run is the CI run. `tests/unit/ci-scripts.test.ts` fails when one of them calls a test runner itself, or when any workflow calls a `scripts/ci/` helper the harness does not.

| Workflow | When | Checks |
| --- | --- | --- |
| `ci.yml` | Every push and pull request | **verify:** `check audit lint typecheck api db-drift db-upgrade catalog`; `run --platform host --coverage` (unit, integration and harness tests, and the coverage floors); the unit suite again with `--timezone Pacific/Kiritimati`; `check coverage` for changed lines (pull requests only; fails on an untested changed line in a gated path); `build`.<br>**browser:** `run --layer ui`: Playwright on desktop and phone. A failed job uploads the run's results, logs and traces as `playwright-results` |
| `container.yml` | Pull requests | Image build, image hygiene, container smoke; the same helpers as `check container`, with the build action's layer cache |
| `openapi.yml` | Pull requests that change `openapi/` | Version increase and breaking changes against `main`, with the helpers `check api-version` and `check api-breaking` call. Breaking changes require the operator's `breaking_api` label; never add it yourself. The version must satisfy the versioning rules either way |
| `mutation.yml` | Mondays, when `src/` or `tests/` changed that week, or by hand | `check mutation`. Reports only; the score and survivors are in the job summary and the `mutation-report` artifact |

### Running CI's jobs locally

Run the same commands the jobs run. Each run starts and removes its own PostgreSQL containers, so the development database is never touched, and prints its run ID and results directory.

```bash
scripts/test.py check audit lint typecheck api db-drift db-upgrade catalog
scripts/test.py run --platform host --coverage
scripts/test.py run --platform host --layer unit --timezone Pacific/Kiritimati
scripts/test.py check coverage --run-id <run-id>
scripts/test.py build
scripts/test.py run --layer ui
scripts/test.py check container api-version api-breaking
```

CodeQL runs through the repository's GitHub default setup (Settings → Code security), not a workflow, so it is not mirrored locally.

### Self-hosted runners

Self-hosted jobs keep their disk between runs. Jobs that check out the repository call [`scripts/ci/runner-cleanup.sh`](../scripts/ci/runner-cleanup.sh) through `.github/actions/runner-cleanup` before setup. The script removes unused Docker data, test databases a killed job left running (containers labelled `familyfi.test-run`), the pnpm store, old tool caches, apt's package cache, `familyfi-*` directories in `/tmp`, and old runner diagnostics. Two agents share a machine, so while another job is running the script leaves the shared Docker daemon and any shared Go or pnpm cache alone. Each runner service keeps its own Go and pnpm caches. Some jobs use GitHub-hosted runners; the workflow files define placement.

**Never run this cleanup script on a development machine.** Local work must clean only resources created by that task; `scripts/test.py` removes only what its own run recorded and never runs runner cleanup.

### Audit allowlist

Empty. An advisory that cannot be fixed yet goes in `pnpm.auditConfig.ignoreGhsas` in `package.json` and gets a row here in the same change, with the advisory, why it does not reach FamilyFi or cannot be fixed, and the date it expires. Remove both when the date passes or a fix ships.

| Advisory | Package | Reason | Expires |
| --- | --- | --- | --- |

## What no test proves

The mock stands in for a gateway, so nothing in CI shows that a real UniFi console enforces a block. FamilyFi has no tool for checking that against a console; the contract cases above keep the mock to the documented API, and only someone watching a test device on a real gateway can confirm a block holds.
