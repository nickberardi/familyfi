# scripts

The top level of this folder holds the scripts you run: `test.py`, `release.sh` and
`doh-probe.mjs`. `testing/` is the implementation behind `test.py`, `ci/` holds the helpers
that the harness and the workflows both call, and `runtime/` the environment and database
bootstrap that the dev server, the tests and the container start through. You normally don't
call `ci/` or `runtime/` directly. `test.py` and `release.sh` print their full usage with
`--help`, and that output is the authority if it disagrees with this page.

```
scripts/
├── test.py            run tests and checks: people, agents, the pre-push hook and CI
│   ├── testing/       catalog, planning, resources, runner adapters and reporting
│   └── tests/         the harness's own tests (Python unittest; the host platform)
├── ci/                check-image, container-smoke, the OpenAPI checks, changed-line coverage,
│                      the migration upgrade check, mutation helpers, runner-cleanup
├── release.sh         checks and tests, then build, push and publish a release from this machine
├── doh-probe.mjs      ask a DNS-over-HTTPS endpoint which transports it actually serves
├── update-mac-vendors.py  rebuild the committed IEEE MAC registrant database; run on request
└── runtime/           with-env, validate-env, docker-entrypoint and the rest of startup;
                       the only part of scripts/ the container image carries
```

Run the scripts from anywhere in the repo; each one finds the repo root itself. The Makefile's
test and check targets are aliases for `test.py`, and `make release` calls `release.sh` with
`RELEASE_ARGS` for options.

Agents can use the [validation](../.agents/skills/validate-change/SKILL.md) and [release](../.agents/skills/release/SKILL.md) skills to select and complete these workflows. This page remains the command reference.

## `test.py`

The one test and validation interface, the same one [familyfi-ios](https://github.com/nickberardi/familyfi-ios)
uses. It needs Python 3.11 or newer on `PATH` (`python3 --version`) and installed dependencies
(`make setup`); integration, browser and database checks also need Docker, and browser tests
Chromium (`pnpm exec playwright install chromium`).

```sh
scripts/test.py run tests/unit/schedule.test.ts
scripts/test.py run "schedule.test.ts > schedule windows across time zones"
scripts/test.py run --category schedules
scripts/test.py run --platform host --layer unit
scripts/test.py run --layer ui --platform phone
scripts/test.py run --layer integration,ui
scripts/test.py run --platform host --coverage
scripts/test.py list --category trust
scripts/test.py run --category pairing --plan
scripts/test.py check lint typecheck api db-drift
scripts/test.py build
scripts/test.py status
scripts/test.py follow <run-id>
scripts/test.py cleanup <run-id>
```

### Selecting tests

A test's identity is its path and titles joined with ` > `, the way Vitest prints it:
`tests/unit/schedule.test.ts > schedule windows across time zones > matches both 01:30s when London falls back`. A selector is an identity or
any prefix of one on a ` > ` boundary, or a directory ending in `/`. `tests/` and the directory
may be left off while the rest names one file; an ambiguous one fails and lists the candidates.
`list` prints identities with their categories, layer and platforms.

| Option | Meaning |
| --- | --- |
| `--category NAME[,NAME]` | Feature categories from `testing/catalog.json`; repeatable |
| `--layer unit,integration,ui` | `unit`: `tests/unit`, `tests/contract` and `scripts/tests`. `integration`: `tests/integration`. `ui`: `tests/browser` |
| `--platform host,desktop,phone,all` | `host` runs Vitest and the harness tests; `desktop` and `phone` are the Playwright projects. Default `all` |
| `--exclude-host` | Leave out host tests another job already runs |
| `--coverage` | Measure coverage against the floors in `tests/vitest.coverage.config.ts`. Only the whole host Vitest suite, since the floors are for all of it |
| `--timezone ZONE` | `TZ` of the test processes, e.g. `Pacific/Kiritimati` |
| `--database postgres,memory` | `postgres` (default, as CI runs): a PostgreSQL container per environment. `memory`: an in-memory PGlite (`scripts/runtime/memory-database.mjs --serve`), with no Docker; a test whose catalog entry says it needs PostgreSQL itself (`"postgres": "<why>"`) is reported `not-run` with that reason. Not with `--coverage` |
| `--show-browser` | Run Playwright headed |
| `--plan` | Print the execution plan; start nothing |
| `--timeout SECONDS` / `--idle SECONDS` | Wall-clock and no-output limits per command (default 2400 and 180) |

`run` needs a selector, category, layer or platform; a bare `run` prints usage. Repeated values in
one filter are a union and different filters intersect. Host tests run once in any selection
unless `--exclude-host`; a layer or category filter applies to them too. Unknown or empty
selections fail before anything starts. `list` and `--plan` start nothing.

Every test belongs to at least one category. A new test file needs an entry in
`testing/catalog.json`, keyed by its path; an entry keyed by `file > describe` or a whole identity
adds categories to part of a file. Every run and `check catalog` fail on an uncategorized test
or an entry that names none. Tests are discovered by the runners themselves (`vitest list`,
`playwright test --list` under CI settings, and unittest), so what is listed is what runs.
A browser file in serial mode (`pair.spec.ts`) is a chain: selecting a later test adds the
earlier ones on that platform, reported as prerequisites, and a failed prerequisite blocks
what follows.

### What a run owns

Each invocation gets a directory under `build/test-runs/<run-id>/` with its plan, resource
manifest, event stream, `results.json`, `summary.md`, logs, Playwright traces and, with
`--coverage`, the coverage report. Each platform that needs a database gets its own
`postgres:18-alpine` container on a Docker-assigned loopback port, named and labelled with the
run ID, and fresh test-only secrets. The database settings and secrets never come from `.env`,
though its other values still fill anything the harness leaves unset (`runtime/with-env.mjs`
reads it), as they did for CI's local mirror. The
browser platforms share one production build per invocation (`.next`) and each gets its own
database and `next start` port. One invocation that starts things runs per worktree at a time;
`status` and `follow` work alongside it, and separate worktrees never share resources.

Resources are recorded as they are made and removed when the run ends, fails or is interrupted.
`cleanup <run-id>` recovers a run whose process was killed, and refuses an active run or a
container not labelled for that run. A cleanup failure fails the invocation. Nothing is kept
between runs except `.next` and the run directory, whose sizes the summary reports.

### Results

Outcomes come from Vitest's and Playwright's JSON reports and a structured unittest adapter,
never from printed text. Each test is passed, failed, expected-failure, skipped, blocked,
cancelled or infrastructure-error, reported separately for selected tests and prerequisites.
The run fails on a failure, a skip, a Playwright test that passed only on its retry, a selected
test with no result, a run where everything skipped, a timeout, a cleanup error, or nothing run
at all. Independent work continues after a failure. The terminal shows each runner's progress
and every result that needs attention; `summary.md` and, in GitHub Actions, the job summary
repeat the counts and failures.

### Checks

`check` runs repository checks, each through the same helper or package script the workflows
call, and reports each as a result.

| Check | What it runs | Needs |
| --- | --- | --- |
| `lint`, `typecheck` | `pnpm lint`, `pnpm typecheck` | |
| `api` | `pnpm test-api`: OpenAPI lint, and every route and method on both sides | |
| `api-version` | `ci/check-openapi-version.mjs` against `--base` | |
| `api-breaking` | `ci/check-openapi-breaking.sh` against `--base` | Go |
| `audit` | `pnpm audit --prod --audit-level=high` | network |
| `db-drift` | migrate a fresh database, then `pnpm db-drift` | Docker |
| `db-upgrade` | `pnpm db-upgrade`: every supported release upgraded to these migrations | Docker |
| `catalog` | every test categorized, every entry used | |
| `coverage` | `ci/changed-line-coverage.mjs` on the lcov of `--run-id`, against `--base` | a passing `--coverage` run |
| `container` | build `familyfi:ci`, then `ci/check-image.sh` and `ci/container-smoke.sh` | Docker |
| `mutation` | `pnpm test:mutation`, then `ci/mutation-summary.mjs`; hours | Docker |

`--base` defaults to `origin/main`, and nothing is fetched. `BREAKING_API_APPROVED=true` in the
environment reflects an operator-approved breaking change, as the `breaking_api` label does in
CI; agents must not set it to get past a failure. The `container` check leaves `familyfi:ci`
behind, as `make docker-smoke` leaves `familyfi:dev`.

```sh
scripts/test.py run --platform host --coverage
scripts/test.py check coverage --run-id <run-id> --base origin/main
```

### The harness's own tests

`scripts/tests/` tests selection, planning, result mapping, resource ownership and cleanup,
the engine and reporting, with synthetic catalogs and a stand-in Docker; they start nothing.

```sh
scripts/test.py run scripts/tests/
```

## `release.sh`

Publishing requires the operator's request. `--skip-ci`, `--allow-dirty` and `--force` are explicit operator exceptions, never normal agent workflow. A script accepting an option does not authorize using it.

Does what `.github/workflows/release.yml` does, from this machine: checks that `HEAD` is on
`origin/main`, runs the checks and tests of `ci.yml`'s verify job and of `container.yml` through
`test.py`, builds `linux/amd64` and `linux/arm64` in one `buildx`
build, pushes them to GHCR, and creates the GitHub Release with generated notes. Creating the
Release creates the tag on GitHub at `HEAD`.

```sh
scripts/release.sh --tag v0.12.1               # checks and tests, build, push, publish
scripts/release.sh --tag v0.12.1 --no-push     # build both architectures, publish nothing
scripts/release.sh --tag v0.12.1 --force       # rebuild and push a released tag checked out at HEAD
```

| Option | What it does |
| --- | --- |
| `--tag vX.Y.Z` | the release to publish; must start with `v` and must not exist on GitHub yet, unless `--force` |
| `--skip-ci` | don't run the checks and tests first |
| `--no-push` | build only: no GHCR login, no push, no GitHub Release |
| `--force` | allow a tag that already exists on GitHub or locally, if it is `HEAD`: rebuild and push its images, overwriting them on GHCR, and create the GitHub Release only if it is missing. `X.Y` and `latest` move only when the tag is the newest release without a `-` |
| `--allow-dirty` | allow uncommitted changes in the working tree; the build uses them |
| `-h`, `--help` | print usage |

- **Image tags** follow `release.yml`'s rules: `X.Y.Z`, plus `X.Y` and `latest` for a tag
  without a pre-release `-`.
- **Credentials:** `GHCR_TOKEN` from the environment or a gitignored `.release.env`, otherwise
  `gh auth token`, which needs the `write:packages` scope (`gh auth refresh -s write:packages`).
  The login lives in a temporary Docker config that is removed on exit, so it never joins your
  stored Docker credentials.
- **Pre-release:** below 1.0 the Release is marked a pre-release, as every release so far has
  been, and so is any tag with a `-`.
- **No double publish:** the tag starts `release.yml`, whose `on-main` job finds this version's
  images already on GHCR and skips everything after it, with a notice saying so. A Release
  created on GitHub, or a tag pushed any other way, has no images yet and builds through
  Actions as before.
- **Emulation:** the architecture your machine isn't is built under emulation, which is slow.

## `ci/` and `runtime/`

- **`ci/`:** called from the harness, from the workflows that do not run through it
  (`container.yml`, `openapi.yml`) and from `package.json` (`test-api`, `db-upgrade`,
  `test:mutation`). `tests/unit/ci-scripts.test.ts` fails when a workflow calls a helper the
  harness does not, or runs a test runner itself. `check-openapi-breaking.sh` and
  `check-openapi-version.mjs` take an optional base ref; without one they fetch
  `origin/$BASE_REF` shallowly, the way CI runs them, so local callers pass `origin/main`.
- **`runtime/`:** `with-env.mjs` loads `.env`, builds `DATABASE_URL`, generates missing secrets
  and prepares the database before running a command. `package.json`, the Makefile, Prisma's
  config, Playwright and the container's `docker-entrypoint.sh` all start through it. The
  Dockerfile copies this folder and nothing else from `scripts/`, and `ci/check-image.sh` fails
  an image that carries `ci/`.
