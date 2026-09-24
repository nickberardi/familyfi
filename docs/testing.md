# Testing

Run these locally before a pull request; CI runs the same checks, listed at the end.

## What to run

The pre-push hook runs `make lint typecheck test-unit` on every push; `make setup` turns it on, and `make hooks` does so in an existing clone. Before you open a pull request, also run the rows your change touches:

| You changed | Run |
| --- | --- |
| Anything | `make test-coverage` |
| Pages, components or `globals.css` | `make test-browser` |
| An `/api/v1` route or payload | `make test-api`, with `openapi/familyfi.v1.yaml` updated in the same change. If the spec changed, `make test-api-breaking` too (needs Go) |
| `prisma/schema.prisma` or a migration | `make db-migrate db-drift db-upgrade`. `db-upgrade` upgrades a filled database from every supported release, so a household that skipped releases is covered; `pnpm db-upgrade --from v0.5.0` or `--latest` runs one start point while you iterate |

**Prerequisites:**
- PostgreSQL. `make setup` starts one with Docker.
- Chromium for the browser tests, installed once with `pnpm exec playwright install chromium`.

Tests always use the `familyfi_test` database, which they create on first run. `resetDatabase` refuses any other database, so your development data is never touched.

## The suites

| Suite | Needs | Covers |
| --- | --- | --- |
| Unit: `tests/unit`, `tests/contract` | Nothing | Pure logic, plus repository-wide rules: naming, colour contrast, icons, client/server boundary, invariants, repository hygiene, Node version |
| Integration: `tests/integration` | PostgreSQL | Route handlers and reconciliation against a mocked UniFi. Every request and response is checked against the OpenAPI document: a request body or path or query parameter the operation does not allow, an undocumented status, or a response body that does not match its schema fails the test |
| Authorization matrix: `tests/integration/authorization-matrix.test.ts` | PostgreSQL | Every `/api/v1` route and method, found on disk, called as anonymous, member, administrator, recovery `admin`, and over the tunnel without a paired phone; each cell must be allowed, 401 or 403 as its table says. A route missing from the table fails it, so a new route declares its access there |
| Browser: `tests/browser` | PostgreSQL, Chromium | Desktop and phone smoke tests on a production build with the UniFi mock, plus axe (WCAG 2.1 A and AA) on every page |
| API contract: `scripts/check-openapi.mjs` | Nothing | Lints the OpenAPI document; every route and method exists on both sides |

The authorization matrix runs with the integration suite. When you add a route, add its line to `ACCESS` in that file; when a guard's access looks wrong, encode what it does today with a `question` and raise it rather than changing both in one step.

`make test` runs unit then integration; `make test-coverage` runs both in one pass and fails below a coverage floor. `make test-browser` builds the app and runs Playwright the way CI does, so a skipped or flaky test fails it locally too.

## Rules

- **A bug fix ships with a test that fails without it.** Write the test first and watch it fail for the reason in the bug report.
- **Coverage floors only go up.** They live in `tests/vitest.coverage.config.ts`. Raise a floor when you lift an area, and never lower one to pass.
- **A changed line in a security-critical path needs a test.** On a pull request, `scripts/changed-line-coverage.mjs` fails CI when a changed line no test runs is in one of `GATED_PATHS`: `src/server/unifi/**`, `auth.ts`, `guard.ts`, `quarantine.ts`, `src/server/tunnel/**` and `reconciliation.ts`, where a file-wide floor would average a new untested branch away. Elsewhere it lists those lines and the floors decide.
  - A line no test can reach takes `// coverage-exempt: <why>` at its end, or alone on the line above. The reason is required, and the run summary lists every exemption so a reviewer sees it.
  - Run it yourself after `make test-coverage`: `node scripts/changed-line-coverage.mjs origin/main`.
- **Never skip your way to green.** In CI, a browser test that skips fails the run, and so does one that passes only on its retry.
  - Tag a test that belongs to one viewport `@desktop` or `@phone`.
  - A test that cannot run in CI takes a tag from `CI_EXCLUDED_TAGS` in `tests/browser-ci-guard.ts`, with the reason.
  - Never skip, disable or quarantine a failing test.
- **Test data is synthetic.** `tests/unit/repository-hygiene.test.ts` enforces this:
  - MAC addresses in tests are locally administered (for example `02:…`);
  - fixture IPv4 addresses come from the documentation ranges `192.0.2.0/24`, `198.51.100.0/24` and `203.0.113.0/24`;
  - never commit a live UniFi response.
- **Requests are held to the OpenAPI document too, not just responses.** `checkedHandler` in `tests/helpers/openapi-responses.ts` validates each JSON body against the operation's `requestBody` and each path and query parameter against its `parameters` before the handler runs, so a handler cannot quietly require more, or accept something different, than the spec says. A negative-path test that sends a request the document forbids, to check the 400, wraps that one request in `invalidRequest(...)`. The marker fails the test if the request is in fact valid or the handler does not answer 4xx; there is no global allowlist. A request the document allows but the handler still refuses (two equal bedtime times, say) needs no marker.
- **The UniFi mock answers like the real API.** `tests/unit/unifi-client-contract.test.ts` runs the cases in `src/server/unifi/contract-cases.ts` against `MockUnifiClient` and `HttpUnifiClient`, and `pnpm spike verify` runs the same cases against a real console. Change the mock and those cases together.
- **Display behaviour is shared with iOS through `tests/fixtures/display-vectors.json`.** See [Display vectors](#display-vectors).
- **Every invariant in AGENTS.md names its tests.** A new invariant comes with them; `tests/unit/invariants.test.ts` fails when one names none or a missing file.
- **Household time never depends on the server's time zone.** CI runs the unit suite a second time at UTC+14 to catch this.

## Display vectors

The native iOS app, [`nickberardi/familyfi-ios`](https://github.com/nickberardi/familyfi-ios), ports the display logic by hand: `src/lib/display.ts`, `groupActionSpecs` in `src/components/group-actions.ts` and the pause sheet in `src/lib/pause-sheet.ts`. `tests/fixtures/display-vectors.json` is the set of cases both must pass, and iOS replays the same file against its port.

- Each vector is `{ "fn", "name", "input", "expected" }`: call `fn` with the named arguments in `input` and compare to `expected`. Instants are ISO 8601 strings, and a returned instant is compared as its ISO string. The file carries a `version`; bump it when the format changes, not when cases do.
- Inputs are plain JSON and pin everything the output depends on: a vector that needs the time names `now` and `timeZone`, never the wall clock. So a display function takes `now` from its caller rather than defaulting to `new Date()`.
- `tests/unit/display-vectors.test.ts` runs every vector against the TypeScript, and fails when an exported function of those modules has no vector and is not on its commented exclusion list.
- **Changing display behaviour means changing the vectors in the same pull request.** That diff is the iOS team’s signal to update the port, so an `expected` value changes only because the behaviour did, and the pull request says which.

## Mutation testing

Coverage shows which lines ran; it does not show whether a test would notice if one of them were wrong. `make test-mutation` checks that. Stryker makes small deliberate bugs, one at a time: `<` becomes `<=`, a condition becomes `true`, `enabled: false` becomes `enabled: true`. It runs the tests that cover each one. A bug no test notices **survives**, and names a behaviour nothing checks.

- **Scope.** It covers the code that decides what a gateway enforces: reconciliation, policy planning, policy ownership, quarantine and schedules. The list is `mutate` in `tests/stryker.config.mjs`.
- **When it runs.** In CI it runs weekly, when `src/` or `tests/` changed that week. You can also run it by hand from the Actions tab or with `make test-mutation`.
- **Not a gate.** It never fails a build. Read the survivors in the HTML report, `reports/mutation/index.html`, or the `mutation-report` artifact in CI. Fix a survivor with a test when it hides a real gap. Leave it when the change makes no observable difference, such as a log message.
- **A workaround.** `scripts/stryker-vitest-names.mjs` fixes a mismatch between Stryker 10 and Vitest 5. Without it no test runs and every mutant survives. The script says when to delete it.

## What CI runs

| Workflow | When | Checks |
| --- | --- | --- |
| `ci.yml` | Every push and pull request | **verify:** lint, typecheck, `test-api`, `db-drift`, `db-upgrade` from every supported release (about 30 seconds), `test:coverage`, the unit suite again at `TZ=Pacific/Kiritimati`, changed-line coverage (pull requests only; fails on an untested changed line in a gated path), production build.<br>**browser:** Playwright in both viewports. A failed run uploads its traces as `playwright-results` |
| `container.yml` | Pull requests | Image build, image hygiene, container smoke |
| `codeql.yml` | Pull requests and weekly | CodeQL (`security-extended`) over the JavaScript and TypeScript; findings go to the repository's code scanning alerts. Only this job may write security events |
| `openapi.yml` | Pull requests that change `openapi/` | Breaking changes against `main`. These fail until the operator adds the `breaking-api` label; never add it yourself |
| `mutation.yml` | Mondays, when `src/` or `tests/` changed that week, or by hand | Mutation testing. Reports only; the score and survivors are in the job summary and the `mutation-report` artifact |

### Audit allowlist

Empty. An advisory that cannot be fixed yet goes in `pnpm.auditConfig.ignoreGhsas` in `package.json` and gets a row here in the same change, with the advisory, why it does not reach FamilyFi or cannot be fixed, and the date it expires. Remove both when the date passes or a fix ships.

| Advisory | Package | Reason | Expires |
| --- | --- | --- | --- |

## What no test proves

The mock stands in for a gateway, so nothing in CI shows that a real UniFi console enforces a block. That proof comes from the operator running `pnpm spike verify` against a console ([spike/OPERATOR.md](spike/OPERATOR.md#verification-run)), which writes a dated, sanitized record to [`docs/verification/`](verification/README.md) and rewrites this table. Each row links the latest record that ran the scenario; "API only" means the console accepted and read back the policies but nobody watched a test device.

<!-- verification-status:start (pnpm spike verify writes this table) -->
| Scenario | Latest result | Record |
| --- | --- | --- |
| Client contract (the cases CI runs against the mock) | not run | |
| IPv4 MAC block and restore | not run | |
| IPv6 block and restore | not run | |
| Bedtime schedule crossing midnight | not run | |
| Two concurrent MACs | not run | |
| Pause and resume leave the schedule intact | not run | |
| Refuses to write an administrator-created policy | not run | |
<!-- verification-status:end -->

IPv4 MAC block and restore was checked by hand on a household gateway with the spike CLI before this mode existed; that run left no record, so the table does not count it.
