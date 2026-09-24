# Testing

Run these locally before a pull request; CI runs the same checks, listed at the end.

## What to run

The pre-push hook runs `make lint typecheck test-unit` on every push; `make setup` turns it on, and `make hooks` does so in an existing clone. Before you open a pull request, also run the rows your change touches:

| You changed | Run |
| --- | --- |
| Anything | `make test-coverage` |
| Pages, components or `globals.css` | `make test-browser` |
| An `/api/v1` route or payload | `make test-api`, with `openapi/familyfi.v1.yaml` updated in the same change. If the spec changed, `make test-api-breaking` too (needs Go) |
| `prisma/schema.prisma` or a migration | `make db-migrate db-drift db-upgrade` |

**Prerequisites:**
- PostgreSQL. `make setup` starts one with Docker.
- Chromium for the browser tests, installed once with `pnpm exec playwright install chromium`.

Tests always use the `familyfi_test` database, which they create on first run. `resetDatabase` refuses any other database, so your development data is never touched.

## The suites

| Suite | Needs | Covers |
| --- | --- | --- |
| Unit: `tests/unit`, `tests/contract` | Nothing | Pure logic, plus repository-wide rules: naming, colour contrast, icons, client/server boundary, invariants, repository hygiene, Node version |
| Integration: `tests/integration` | PostgreSQL | Route handlers and reconciliation against a mocked UniFi. Every response is checked against the OpenAPI document; an undocumented status or a body that does not match its schema fails the test |
| Authorization matrix: `tests/integration/authorization-matrix.test.ts` | PostgreSQL | Every `/api/v1` route and method, found on disk, called as anonymous, member, administrator, recovery `admin`, and over the tunnel without a paired phone; each cell must be allowed, 401 or 403 as its table says. A route missing from the table fails it, so a new route declares its access there |
| Browser: `tests/browser` | PostgreSQL, Chromium | Desktop and phone smoke tests on a production build with the UniFi mock, plus axe (WCAG 2.1 A and AA) on every page |
| API contract: `scripts/check-openapi.mjs` | Nothing | Lints the OpenAPI document; every route and method exists on both sides |

The authorization matrix runs with the integration suite. When you add a route, add its line to `ACCESS` in that file; when a guard's access looks wrong, encode what it does today with a `question` and raise it rather than changing both in one step.

`make test` runs unit then integration; `make test-coverage` runs both in one pass and fails below a coverage floor. `make test-browser` builds the app and runs Playwright the way CI does, so a skipped or flaky test fails it locally too.

## Rules

- **A bug fix ships with a test that fails without it.** Write the test first and watch it fail for the reason in the bug report.
- **Coverage floors only go up.** They live in `tests/vitest.coverage.config.ts`. Raise a floor when you lift an area, and never lower one to pass. On a pull request, CI also lists the changed lines no test runs.
- **Never skip your way to green.** In CI, a browser test that skips fails the run, and so does one that passes only on its retry.
  - Tag a test that belongs to one viewport `@desktop` or `@phone`.
  - A test that cannot run in CI takes a tag from `CI_EXCLUDED_TAGS` in `tests/browser-ci-guard.ts`, with the reason.
  - Never skip, disable or quarantine a failing test.
- **Test data is synthetic.** `tests/unit/repository-hygiene.test.ts` enforces this:
  - MAC addresses in tests are locally administered (for example `02:…`);
  - fixture IPv4 addresses come from the documentation ranges `192.0.2.0/24`, `198.51.100.0/24` and `203.0.113.0/24`;
  - never commit a live UniFi response.
- **The UniFi mock answers like the real API.** `tests/unit/unifi-client-contract.test.ts` runs the same cases against `MockUnifiClient` and `HttpUnifiClient`. Change the mock and those cases together.
- **Every invariant in AGENTS.md names its tests.** A new invariant comes with them; `tests/unit/invariants.test.ts` fails when one names none or a missing file.
- **Household time never depends on the server's time zone.** CI runs the unit suite a second time at UTC+14 to catch this.

## What CI runs

| Workflow | When | Checks |
| --- | --- | --- |
| `ci.yml` | Every push and pull request | **verify:** `pnpm audit --prod --audit-level=high` (a high or critical advisory in a production dependency fails it; see [Audit allowlist](#audit-allowlist)), lint, typecheck, `test-api`, `db-drift`, `db-upgrade`, `test:coverage`, the unit suite again at `TZ=Pacific/Kiritimati`, changed-line coverage (pull requests only), production build.<br>**browser:** Playwright in both viewports. A failed run uploads its traces as `playwright-results` |
| `container.yml` | Pull requests | Image build, image hygiene, container smoke |
| `codeql.yml` | Pull requests and weekly | CodeQL (`security-extended`) over the JavaScript and TypeScript; findings go to the repository's code scanning alerts. Only this job may write security events |
| `openapi.yml` | Pull requests that change `openapi/` | Breaking changes against `main`. These fail until the operator adds the `breaking-api` label; never add it yourself |

### Audit allowlist

Empty. An advisory that cannot be fixed yet goes in `pnpm.auditConfig.ignoreGhsas` in `package.json` and gets a row here in the same change, with the advisory, why it does not reach FamilyFi or cannot be fixed, and the date it expires. Remove both when the date passes or a fix ships.

| Advisory | Package | Reason | Expires |
| --- | --- | --- | --- |

## What no test proves

The mock stands in for a gateway, so nothing here shows that a real UniFi console enforces a block. Live checks are manual, with the spike CLI in [spike/OPERATOR.md](spike/OPERATOR.md). IPv4 MAC block and restore has been proven on a household gateway. IPv6, the overnight UniFi scheduler and a second concurrent MAC have not.
