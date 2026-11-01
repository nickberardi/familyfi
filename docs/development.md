# Development conventions

Read the relevant sections before editing code. [AGENTS.md](../AGENTS.md) holds the shared workflow and safety invariants; [testing.md](testing.md) defines validation. These conventions apply to both agents and contributors.

## Implementation and review

- Trace the existing caller, implementation and tests before adding a path. Reuse the existing owner of a behaviour; if it is wrong, fix it there and check its callers.
- Keep each change focused on the requested behaviour. Extract a helper when it represents a coherent operation or removes meaningful duplication. Do not add a service layer, generic factory, configuration option or dependency for a hypothetical future caller.
- Prefer explicit inputs and return values. Keep pure decisions separate from database, network and process effects when that makes them testable; use the existing module boundaries rather than adding a parallel architecture.
- Validate untrusted input at the boundary. Preserve useful TypeScript types internally; do not use `any`, unchecked assertions or suppression comments to conceal a mismatch.
- Handle errors where the caller can make a decision. Do not catch an error and return success, an empty result or a made-up default. Preserve the distinction between pending, failed, unknown and successful outcomes.
- For asynchronous writes, consider retries, concurrent calls and partial failure. Use the existing transactions, locks and ownership checks. Explain a new retry or fallback with the failure it handles and how duplicate effects are prevented.
- Remove code made obsolete by the change, including dead parameters and stale comments. Keep unrelated cleanup separate. Comments should explain a constraint or decision that the code cannot express.
- Tests assert observable behaviour and failure cases, not copies of the implementation. Mock external boundaries; keep the decision under test real. Coverage measures execution, not correctness.

Before handing off, review the complete diff against the request: is each new abstraction needed, is behaviour implemented in one place, are failures visible, and do tests fail if the behaviour is broken? For UI changes inspect the rendered result at desktop and phone sizes, including relevant loading, empty and error states. Use the mock; live gateway writes require the operator's request.

## Maintaining instructions

Keep broadly applicable instructions in `AGENTS.md`; keep detailed rules on this page and validation in `testing.md`. `CLAUDE.md` imports the same root instructions. Link task-specific references with a clear trigger so agents know when to read them. Do not duplicate the rules across tool-specific files.

Add a rule after identifying a concrete recurring failure or a safety requirement. Make it actionable, name its rationale, and add a check when the rule can be checked reliably. Do not add arbitrary file-size limits, abstraction quotas or tests that merely search for the new instruction's wording. Remove obsolete instructions when behaviour changes.

Keep commands, paths and claims in sync with their implementations in the same change. Label examples and unverified hardware claims. A passing instruction-link test proves a reference exists; it does not prove the underlying invariant is covered.

When a feature changes, update its entry in the [architecture feature map](architecture.md#feature-map)
and any affected flow, design decision or contract guidance. Keep each fact with its owner and link
to it elsewhere. Native implementation details belong in the native repository. If documented intent,
tests and implementation disagree, identify the discrepancy and resolve it within the requested scope;
do not silently declare the existing code or an old prototype correct. Keep session findings and
review reports in the conversation or PR, not in `docs/`.

## Naming

**The rule: a name leads with the full product name, or with nothing. Never an abbreviation.** No `Fam`, `fam-` or `fam_` in identifiers. Environment variables an operator sets lead with `FAMILYFI_`; everything internal leads with nothing, because the repo is already the product.

CSS custom properties are the one place an abbreviation is right: `:root` is a global namespace shared with the browser and any library, so tokens take a short `--ff-` prefix to stay readable at the density they are used. That prefix is closed — do not coin others.

| Layer | Convention | Example |
| --- | --- | --- |
| React components | `PascalCase.tsx`, one component per concept | `RuleEditor.tsx`, `GroupCard.tsx` |
| Logic modules (`lib/`, `server/`) | `kebab-case.ts` | `rule-writes.ts`, `unifi-settings.ts` |
| Directories | lowercase, no separators | `components/ui`, `server/unifi` |
| Functions, variables, props | `camelCase` | `ruleWritePlan`, `parentFacingRuleLabel` |
| Module constants | `SCREAMING_SNAKE` | `SESSION_TTL_MS`, `CURATED_CATEGORY_SLOTS` |
| Prisma models / tables | `PascalCase`, singular | `Rule`, `RulePolicy`, `SyncRun` |
| Columns and JSON fields | `camelCase` | `pauseActive`, `targetIds` |
| Prisma enum values | `lowercase` | `family`, `scheduled`, `quarantined` |
| API paths | lowercase, plural, `{id}` | `/api/v1/groups/{id}/rules/{ruleId}/pause` |
| Our env vars | `FAMILYFI_` + purpose | `FAMILYFI_ENCRYPTION_KEY` |
| CSS tokens | `--ff-` + kebab role | `--ff-hairline-card`, `--ff-ink-3` |

- **`camelCase` runs unbroken from column to JSON.** The schema uses Prisma defaults with zero `@map`/`@@map`, so a Postgres column, a Prisma field, a TypeScript property and an API response field are the same string. Do not introduce a snake_case boundary; it would buy nothing and cost a translation layer.
- **The prefix marks public surface, not ownership.** It belongs on variables an operator sets to run a real deployment — the ones documented in `.env.example`, the README and `docs/`, where a name like `DEFAULT_PASSWORD` would be ambiguous in a shared shell or a Compose file. Two kinds of variable take no prefix: those configuring an external system, which keep that system's convention (`POSTGRES_*`, `DB_*`, `GITHUB_*`, and framework contracts like `DATABASE_URL`, `PORT`, `NODE_ENV`); and development-, test- or CI-only flags, which are never part of a deployment. `KILL_PORT`, `SKIP_DB_PREPARE`, `CLOUDFLARED_BIN` and `CLOUDFLARE_API_URL` (tests only: a stand-in `cloudflared` and Cloudflare API), and `BASE_REF` and `BREAKING_API_APPROVED` (the OpenAPI checks' base branch and `breaking_api` label) are the second kind — ours, but local or internal plumbing, so they stay bare. Today that leaves `FAMILYFI_DEFAULT_PASSWORD`, `FAMILYFI_ENCRYPTION_KEY`, `FAMILYFI_PORT`, `FAMILYFI_UPDATE_TAG`, `FAMILYFI_REMOTE_ACCESS_PORT`, `FAMILYFI_UPDATER_URL`, `FAMILYFI_MODE`, and the hosted demo's `FAMILYFI_DEMO_URL` as the whole prefixed set.
- **Renaming an env var is breaking.** The value must move with the name. `FAMILYFI_ENCRYPTION_KEY` in particular: a fresh key makes the stored UniFi API key undecryptable and Sync fails with "Unsupported state or unable to authenticate data".
- **Renaming a model is a migration, not a schema edit.** `ALTER ... RENAME` the table, enums, columns, constraints and indexes in place so existing databases upgrade. Constraints keep their old generated names through a table rename — bring them along, then run `make db-migrate db-drift db-upgrade`. `prisma migrate status` checks migration history; `db-drift` compares the database with the schema. Never rewrite an already applied migration to rename an object.
- **The history starts from a baseline.** `00000000000000_baseline` replaced every prerelease migration; prerelease databases are not upgraded ([upgrades](operations.md#upgrades)). New migrations follow it as usual, and every release from the baseline on must upgrade to the newest.
- **Every time is an instant.** A `DateTime` column is `@db.Timestamptz(3)`, and `createPrismaClient` runs each session in UTC, so neither the database's own time zone nor another reader's moves a stored time. `tests/integration/database-time-zone.test.ts` fails on a column without a time zone. Household clock times (rule windows, the probe schedule) are `HH:MM` strings read in `Household.timezone` through `src/lib/clock.ts`.
- **Internal naming has no legacy carve-out.** Remove obsolete internal aliases when their callers have migrated. This does not authorize breaking an HTTP contract, discarding persisted data, editing applied migrations or regenerating deployment secrets; follow the migration and API compatibility rules. A policy is ours when its id and creation evidence are on record for this console and site — never because of its name, `FamilyFi ` or any other.

## Design system and interactions

The design system, its interaction rules and the web's styling conventions live in [design.md](design.md), the repository's copy of the FamilyFi Design System project. Read it before UI work, and record a new design decision there (and in the project, through the [design-sync skill](../.agents/skills/design-sync/SKILL.md)) when it is implemented.

## Commands

What to run before a pull request, the rules tests follow, and what CI checks are in [testing.md](testing.md). Tests and checks run through `scripts/test.py`, and the `make` test and check targets below are aliases for it; its selections (one test, a category, a layer, a platform) are in [scripts/README.md](../scripts/README.md#testpy). Every run starts its own PostgreSQL containers and removes them afterwards, so tests never touch the development database.

| Target | Behavior |
| --- | --- |
| `make setup` | Install, create `.env` if missing, start the dev database when Docker is available, migrate, and turn on the pre-push hook |
| `make hooks` | Turn on `.githooks/pre-push` (lint, typecheck, unit tests) in an existing clone |
| `make dev` | Next.js on port 3000. For UI work without a UniFi console, set `FAMILYFI_MODE=dev` in `.env` first (dummy household; add `DB_MODE=memory` to skip PostgreSQL; see [setup.md](setup.md#modes)). |
| `make release` | `scripts/release.sh`: checks and tests, then build, push and publish a release from this machine (`RELEASE_ARGS="--tag vX.Y.Z"`) |
| `make test-unit` | `scripts/test.py run --platform host --layer unit`: unit and harness tests; no database |
| `make test` | `run --platform host`: unit, integration and harness tests |
| `make test-integration` | `run --layer integration` |
| `make test-coverage` | `run --platform host --coverage`: unit and integration tests in one run; fails below the coverage floors |
| `make test-browser` | `run --layer ui`: production build, then Playwright on desktop and phone, the way CI runs it |
| `make test-api` | `check api`: OpenAPI lint, and every route and method documented |
| `make test-api-breaking` | `check api-breaking`: breaking OpenAPI changes against `origin/main` |
| `make test-api-floors` | `check api-floors`: OpenAPI `x-min-app` and `x-min-server` rose where a change needs it, and `x-min-watch` (set by hand) is valid and never falls or passes `info.version`, against `origin/main` |
| `make test-api-version` | `check api-version`: OpenAPI `info.version` is a semver increase over `origin/main` that fits the change |
| `make test-mutation` | `check mutation`: mutation testing of the enforcement code; a report, never a gate |
| `make db-migrate` | Apply migrations to the development database |
| `make db-drift` | `check db-drift`: migrate a fresh database and fail where `schema.prisma` differs from it |
| `make db-upgrade` | `check db-upgrade`: upgrade a filled database from every supported release; fail on an error, lost rows or drift, naming the release. `pnpm db-upgrade --from <tag>` or `--latest` runs one start point against the development database while you iterate (with PostgreSQL 18's client tools on the machine) |
| `make lint` / `make typecheck` | `check lint` / `check typecheck` |
| `make build` | Production build |
| `make docker-build` | Build `familyfi:dev` |
| `make docker-dev-up` | Locally built image plus Compose PostgreSQL |
| `make docker-up` | GHCR image plus Compose PostgreSQL |
| `make docker-down` | Stop without deleting volumes |
| `make docker-smoke` | Build `familyfi:dev`, reject `designs/` in the image, run health/login against bundled-style external Postgres |

The container smoke runs on pull requests but not on ordinary pushes to `main`. For an unpublished release tag on `main`, `release.yml` requires CI and container smoke before building images. If the release's notes already name an image GHCR has, the workflow skips those jobs and publishing; the local release path runs the same checks and tests through `scripts/test.py` by default. See [operations](operations.md#releases) and [scripts](../scripts/README.md#releasesh).
