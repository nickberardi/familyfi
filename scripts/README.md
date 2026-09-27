# scripts

The top level of this folder holds the scripts you run: `ci.sh`, `release.sh`, `doh-probe.mjs`
and the `spike/` CLI. `ci/` holds the helpers that CI and `ci.sh` both call, and `runtime/` the
environment and database bootstrap that the dev server, the tests and the container start
through. You normally don't call either folder directly. `ci.sh` and `release.sh` print their
full usage with `--help`, and that output is the authority if it disagrees with this page.

```
scripts/
├── ci.sh              run the CI workflows' jobs on this machine
│   └── ci/            check-image, container-smoke, the OpenAPI checks, changed-line coverage,
│                      the migration upgrade check, mutation helpers, runner-cleanup
├── release.sh         CI, then build, push and publish a release from this machine
├── doh-probe.mjs      ask a DNS-over-HTTPS endpoint which transports it actually serves
├── spike/             UniFi integration spike CLI (make spike; docs/spike/OPERATOR.md)
└── runtime/           with-env, validate-env, docker-entrypoint and the rest of startup;
                       the only part of scripts/ the container image carries
```

Run the scripts from anywhere in the repo; each one finds the repo root itself. `make ci` and
`make release` call them too, with `CI_ARGS` and `RELEASE_ARGS` for options.

Agents can use the [validation](../.agents/skills/validate-change/SKILL.md) and [release](../.agents/skills/release/SKILL.md) skills to select and complete these workflows. This page remains the command reference.

## `ci.sh`

Runs the jobs of `.github/workflows/ci.yml`, `container.yml`, `openapi.yml` and `mutation.yml`
using local equivalents of the workflow commands. Each job is named after the workflow job it
mirrors. `tests/unit/ci-scripts.test.ts` checks job names, referenced helpers and script paths.
It does not compare every command, option or environment variable; review those together
when either execution path changes.

```sh
scripts/ci.sh                          # verify, browser, container and both OpenAPI checks
scripts/ci.sh --quick                  # verify and container
scripts/ci.sh --only browser
scripts/ci.sh --skip openapi-breaking --keep-going
scripts/ci.sh --only mutation          # the weekly mutation run; takes hours
```

| Option | What it does |
| --- | --- |
| `--quick` | run `verify` and `container`, which is what `release.sh` runs |
| `--only JOB…` | run only these jobs |
| `--skip JOB…` | leave these jobs out |
| `--base REF` | what changed-line coverage and the OpenAPI checks compare against (default `origin/main`); nothing is fetched |
| `--breaking-api` | reflects an operator-approved breaking change locally; agents must not set it to bypass a failure. CI still requires the operator's `breaking_api` label |
| `--keep-going` | keep running after a job fails, then report every failure |
| `-h`, `--help` | print usage |

| Job | Mirrors | Needs |
| --- | --- | --- |
| `verify` | `ci.yml` verify | Docker |
| `browser` | `ci.yml` browser | Docker |
| `container` | `container.yml` | Docker |
| `openapi-version` | `openapi.yml` version | |
| `openapi-breaking` | `openapi.yml` breaking | Go |
| `mutation` | `mutation.yml`; only with `--only` | Docker |

- **Database:** each job that needs PostgreSQL gets its own disposable `postgres:18-alpine` container
  on a free loopback port, with `ci.yml`'s credentials, and the test-only secrets `ci.yml` sets.
  The container is removed when the job ends, fails or is interrupted, and the development
  database is never touched. `.env` still fills any variable CI leaves unset, because
  `runtime/with-env.mjs` reads it.
- **Changed-line coverage** runs when `HEAD` differs from `--base`, where CI runs it on a pull
  request.
- **Not mirrored:** `codeql.yml`, which needs the CodeQL CLI, and the `runner-cleanup` step,
  which wipes Docker and caches the way a CI runner should and your machine should not.
- **Output:** logs go to `build/ci/<job>.log`, with a results table at the end. The `container`
  job leaves the `familyfi:ci` image behind, as `make docker-smoke` leaves `familyfi:dev`.

## `release.sh`

Publishing requires the operator's request. `--skip-ci` and `--allow-dirty` are explicit operator exceptions, never normal agent workflow. A script accepting an option does not authorize using it.

Does what `.github/workflows/release.yml` does, from this machine: checks that `HEAD` is on
`origin/main`, runs `ci.sh --quick`, builds `linux/amd64` and `linux/arm64` in one `buildx`
build, pushes them to GHCR, and creates the GitHub Release with generated notes. Creating the
Release creates the tag on GitHub at `HEAD`.

```sh
scripts/release.sh --tag v0.12.1               # ci.sh --quick, build, push, publish
scripts/release.sh --tag v0.12.1 --no-push     # build both architectures, publish nothing
```

| Option | What it does |
| --- | --- |
| `--tag vX.Y.Z` | the release to publish; must start with `v` and must not exist on GitHub yet |
| `--skip-ci` | don't run `ci.sh --quick` first |
| `--no-push` | build only: no GHCR login, no push, no GitHub Release |
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

- **`ci/`:** called from the workflows, from `ci.sh`, from `package.json` (`test-api`,
  `db-upgrade`, `test:mutation`) and from the Makefile. `check-openapi-breaking.sh` and
  `check-openapi-version.mjs` take an optional base ref; without one they fetch
  `origin/$BASE_REF` shallowly, the way CI runs them, so local callers pass `origin/main`.
- **`runtime/`:** `with-env.mjs` loads `.env`, builds `DATABASE_URL`, generates missing secrets
  and prepares the database before running a command. `package.json`, the Makefile, Prisma's
  config, Playwright and the container's `docker-entrypoint.sh` all start through it. The
  Dockerfile copies this folder and nothing else from `scripts/`, and `ci/check-image.sh` fails
  an image that carries `ci/` or `spike/`.
