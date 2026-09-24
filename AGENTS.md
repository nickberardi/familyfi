<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# FamilyFi agent notes

Human-facing product docs live in [README.md](README.md) and `docs/`. This file is for coding agents and contributors working in the repo.

## Invariants

Each invariant names the tests that enforce it; `tests/unit/invariants.test.ts` fails when one names none, or names a file that does not exist. A new invariant comes with its tests.

- One deployment serves one household. Desired state is in PostgreSQL; UniFi firewall policies are enforcement only. *Tests:* `tests/integration/reconcile.test.ts`, `tests/integration/reconcile-properties.test.ts`.
- Never modify, disable, delete, or reorder administrator-created policies. Never call the UniFi policy ordering PUT. Own policies by recorded IDs and creation evidence for this console and site, never by name: names may one day be chosen by the operator, and an administrator's policy can carry any name. Every client `clientForHousehold` hands out goes through `src/server/unifi/policy-ownership.ts`, which refuses to update or delete any policy not on record, whichever code path supplies the id. *Tests:* `tests/integration/policy-ownership.test.ts`, `tests/integration/reconcile-properties.test.ts`, `tests/unit/unifi.test.ts`.
- All UniFi calls are server-side. Do not put keys or UniFi clients in the browser. `tests/unit/client-boundary.test.ts` fails when a `"use client"` file or a `src/lib` module reaches `src/server` or a server-only package, even through other modules. *Tests:* `tests/unit/client-boundary.test.ts`.
- Every `/api/v1` route and method declares who may call it — anonymous, a member, an administrator, the recovery account, or a caller over the tunnel without a paired phone — in the authorization matrix. A route the matrix does not name fails the suite, and so does a guard that widens or narrows access without the table changing with it. *Tests:* `tests/integration/authorization-matrix.test.ts`.
- Do not create UniFi Object Manager groups. Operators paste an Integration API key in Settings; FamilyFi encrypts it with `FAMILYFI_ENCRYPTION_KEY`. *Tests:* `tests/unit/unifi-client-surface.test.ts`, `tests/integration/unifi-key-storage.test.ts`, `tests/unit/crypto.test.ts`.
- `UNIFI_MOCK=1` is local-only dummy UniFi plus a seeded household for UI work. Never treat it as enforcement. It is ignored when `NODE_ENV=production`. *Tests:* `tests/unit/unifi-mock.test.ts`.
- Pause suspends schedule enforcement (`enabled: false` on app-owned policies, schedule preserved). Resume is `enabled: true`; bedtime may still block. Recurring bedtime is the UniFi policy `schedule`, not clock-driven enable/disable at window edges. *Tests:* `tests/integration/reconcile-properties.test.ts`, `tests/unit/schedule.test.ts`.
- Protection is per group. Do not expose controls that bypass protection. *Tests:* `tests/integration/reconcile.test.ts`, `tests/integration/reconcile-properties.test.ts`.
- Unassigned devices are **quarantined** in the API and tests; the Devices UI may say **Unassigned**. Discovery and quarantine only include clients on managed VLANs. *Tests:* `tests/integration/reconcile.test.ts`, `tests/integration/reconcile-properties.test.ts`, `tests/integration/quarantine-observe.test.ts`.
- Remote access tunnels point only at the phone-only gateway (`src/server/tunnel/phone-gateway.ts`), never at the web app. The gateway passes `/api/v1/*` only, strips cookies, and stamps `x-familyfi-via: tunnel`; over a tunnel, sign-in requires a paired phone checked before the password. `cloudflared` is pinned and hash-checked in the image, never downloaded at runtime. *Tests:* `tests/unit/phone-gateway.test.ts`, `tests/integration/remote-access.test.ts`, `tests/integration/connection-api.test.ts`, `tests/integration/authorization-matrix.test.ts`.
- Upstream DNS categories are reporting only — they never create a UniFi policy, so their routes return no `change` and never enqueue reconciliation. `src/lib/upstream-domains.ts` is a seed reconciled into the database at boot, not runtime data; the probe reads the database. A verdict of `unknown` means we could not look, and must never be shown or stored as `open`. *Tests:* `tests/integration/upstream-checks-api.test.ts`, `tests/integration/upstream-categories-api.test.ts`, `tests/unit/upstream-domain-verdict.test.ts`, `tests/integration/upstream-seed.test.ts`.
- Do not commit `/designs/`, `.env`, UniFi keys, or unsanitized household API dumps. `designs/` is local-only UI reference; public code must not import from it. *Tests:* `tests/unit/repository-hygiene.test.ts`.

## Stack and layout

Next.js App Router + TypeScript, React, Tailwind, Prisma/PostgreSQL, OpenAPI under `openapi/`. Makefile targets mirror GitHub Actions.

```text
src/app          pages, layouts, api/v1 route handlers
src/components   shared UI
src/server       env, database, auth, schedule, UniFi, reconciliation
src/lib          client-safe constants and types
prisma           PostgreSQL schema and migrations
openapi          versioned HTTP contract
tests            unit, integration, contract, browser
scripts          spike, env, image/smoke checks
docker           Dockerfile and Compose (build context is repo root)
docs             setup, architecture, operations, API, spike operator checklist
```

Before UI work, read local `designs/` (`Web Design.dc.html`, `Sign In.dc.html`, and the `_ds/` design-system bundle: `readme.md`, `tokens/`, `_ds_bundle.js`) when present. This file and [docs/architecture.md](docs/architecture.md) override prototype logic (including “Pause blocks internet”). Accessibility: contrast at least 4.5:1; no text under 14px rendered below 0.7 alpha. `tests/unit/mark-contrast.test.ts` checks the colour tokens and `tests/browser/accessibility.spec.ts` runs axe (WCAG 2.1 A and AA) on every page in both viewports, with no exceptions. Do not click live UniFi writes unless the operator asked.

UniFi integration: official Network Integration API with `X-API-KEY`. Local base `https://<console-ip>/proxy/network/integration`; cloud connector `https://api.ui.com/v1/connector/consoles/{consoleId}/proxy/network/integration`. Internet-block action is `BLOCK` (not `REJECT`). Spike CLI: [docs/spike/OPERATOR.md](docs/spike/OPERATOR.md).

## Naming

**The rule: a name leads with the full product name, or with nothing. Never an abbreviation.** No `Fam`, `fam-` or `fam_` in identifiers. Environment variables an operator sets lead with `FAMILYFI_`; everything internal leads with nothing, because the repo is already the product.

CSS custom properties are the one place an abbreviation is right: `:root` is a global namespace shared with the browser and any library, so tokens take a short `--ff-` prefix to stay readable at the density they are used. That prefix is closed — do not coin others.

| Layer | Convention | Example |
| --- | --- | --- |
| React components | `PascalCase.tsx`, one component per concept | `RuleRow.tsx`, `GroupCard.tsx` |
| Logic modules (`lib/`, `server/`) | `kebab-case.ts` | `rule-rows.ts`, `unifi-settings.ts` |
| Directories | lowercase, no separators | `components/ui`, `server/unifi` |
| Functions, variables, props | `camelCase` | `buildRuleRows`, `parentFacingRuleLabel` |
| Module constants | `SCREAMING_SNAKE` | `SESSION_TTL_MS`, `CURATED_CATEGORY_SLOTS` |
| Prisma models / tables | `PascalCase`, singular | `Rule`, `RulePolicy`, `SyncRun` |
| Columns and JSON fields | `camelCase` | `suspensionActive`, `targetIds` |
| Prisma enum values | `lowercase` | `family`, `scheduled`, `quarantined` |
| API paths | lowercase, plural, `{id}` | `/api/v1/groups/{id}/pause` |
| Our env vars | `FAMILYFI_` + purpose | `FAMILYFI_ENCRYPTION_KEY` |
| CSS tokens | `--ff-` + kebab role | `--ff-hairline-card`, `--ff-ink-3` |

- **`camelCase` runs unbroken from column to JSON.** The schema uses Prisma defaults with zero `@map`/`@@map`, so a Postgres column, a Prisma field, a TypeScript property and an API response field are the same string. Do not introduce a snake_case boundary; it would buy nothing and cost a translation layer.
- **The prefix marks public surface, not ownership.** It belongs on variables an operator sets to run a real deployment — the ones documented in `.env.example`, the README and `docs/`, where a name like `DEFAULT_PASSWORD` would be ambiguous in a shared shell or a Compose file. Two kinds of variable take no prefix: those configuring an external system, which keep that system's convention (`POSTGRES_*`, `DB_*`, `UNIFI_API_KEY`, `GITHUB_*`, and framework contracts like `DATABASE_URL`, `PORT`, `NODE_ENV`); and development-, test- or CI-only flags, which are never part of a deployment. `UNIFI_MOCK`, `KILL_PORT`, `SKIP_DB_PREPARE`, `CLOUDFLARED_BIN` (tests only: a stand-in `cloudflared`), and `BASE_REF` and `BREAKING_API_APPROVED` (the OpenAPI checks' base branch and `breaking-api` label) are the second kind — ours, but local or internal plumbing, so they stay bare. Today that leaves `FAMILYFI_DEFAULT_PASSWORD`, `FAMILYFI_SESSION_SECRET`, `FAMILYFI_ENCRYPTION_KEY`, `FAMILYFI_PORT`, `FAMILYFI_IMAGE` and `FAMILYFI_PHONE_GATEWAY_PORT` as the whole prefixed set.
- **Renaming an env var is breaking.** The value must move with the name. `FAMILYFI_ENCRYPTION_KEY` in particular: a fresh key makes the stored UniFi API key undecryptable and Sync fails with "Unsupported state or unable to authenticate data".
- **Renaming a model is a migration, not a schema edit.** `ALTER ... RENAME` the table, enums, columns, constraints and indexes in place so existing databases upgrade. Constraints keep their old generated names through a table rename — bring them along, then confirm `prisma migrate status` reports no drift.
- **There is no legacy carve-out.** FamilyFi is pre-release, so nothing in the repo exists to stay compatible with an older name. A policy is ours when its id and creation evidence are on record for this console and site — never because of its name, `FamilyFi ` or any other. If you find yourself adding a second, older name to stay compatible with, delete the old name instead.

### Styling

- **Never write a raw colour literal.** Every colour is a `--ff-*` token in `src/app/globals.css`; add a token rather than inlining `rgba(...)` or a hex. The only exception is `themeColor` in `src/app/layout.tsx`, which the browser reads before CSS exists.
- Prefer a shared primitive in `src/components/ui` over a fourth copy of the same control. If you are writing a segmented control, a mark, a day picker or a pill, one already exists.
- The Card System's density ladder is 44 / 32 / 24 px marks — comfortable, compact, dense. Never a fourth size.
- **The verdict palette is one system.** Five states — `rule`, `blocked`, `partial`, `open`, `unknown` — each with an ink, a fill and a line under `--ff-verdict-*`. The colour answers *who* is blocking, which is why none of them borrows the accent. Never restyle a verdict locally and never reuse those colours for something that is not a verdict. `unknown` means we could not look; it must never read as `open`.

### Type

**Inter** carries every UI size and **JetBrains Mono** the machine column — MAC addresses, IPs, policy names, endpoints, timestamps. Both are loaded by `next/font` in `src/app/layout.tsx`, which downloads them at build time and serves them from the deployment, so a household gateway never reaches Google Fonts at runtime. `--ff-font`, `--ff-font-display` and `--ff-font-mono` are the only names to use; `@theme` forwards Tailwind's `font-sans`/`font-mono` to them, so `font-mono` on an identifier is correct and a hand-written stack is not.

### Brand

The mark is **artwork, not geometry**. `src/components/ui/Logo.tsx` composes `public/brand/shield-family.png` (the shield with the family inside), `shield-check-light.png` / `-deep.png` (the small check shield that dots the **i** of Fi, cut once per ground so it never traps the wrong colour) and `app-icon.png` (the shield on its navy tile, also the favicon and the web manifest icon). Only the wordmark is live text, so it can invert. **Never redraw or approximate the shield** — place the file.

The brand ground is a separate palette from the product UI: deep navy `--ff-brand-deep`, azure `--ff-brand-cyan`, declared under the brand-layer comment at the foot of `:root` in `globals.css`. It belongs to the mark, the app icon, the splash and marketing. The accent blue stays the only interactive colour; nothing clickable may take the brand cyan.

### Iconography

FamilyFi's own iconography is typographic and geometric — monograms inside `Mark`, the CSS shapes in `CategoryGlyph`, chevrons — and that covers everything the product invented. Everything the world already named (a phone, a printer, a gear) comes from **Phosphor Regular**, imported once in `src/app/layout.tsx` from the `@phosphor-icons/web` package rather than a CDN.

`src/components/ui/Icon.tsx` is the only place that may write a `ph ph-…` class, and `IconName` in `src/lib/icons.ts` is the closed set of glyphs it accepts. A name Phosphor does not have renders as *nothing at all*, which is why the union is checked against the shipped stylesheet in `tests/unit/icons.test.ts`. Do not mix in a second icon pack, and do not hand-draw a replacement for a glyph Phosphor has. Named apps keep short monograms rather than real logos — a licensing decision, not a style one. Emoji are never used.

### Enforcement

`tests/unit/naming.test.ts` fails the build on a raw colour literal, an abbreviated product prefix, a misnamed file, an unprefixed env var of ours, a `var(--ff-…)` reference with no declaration, and a Phosphor class written outside `Icon`. `tests/unit/icons.test.ts` fails it on a glyph name the installed icon font does not have, and `tests/unit/mark-contrast.test.ts` on a verdict, accent, status or text colour under 4.5:1. These rules were written down once before and drifted anyway — the tokens existed while 71 literals sat in components — so treat the tests as the contract and this section as their explanation. Extend both together.

## Commands

What to run before a pull request, the rules tests follow, and what CI checks are in [docs/testing.md](docs/testing.md).

| Target | Behavior |
| --- | --- |
| `make setup` | Install, create `.env` if missing, start the dev database when Docker is available, migrate, and turn on the pre-push hook |
| `make hooks` | Turn on `.githooks/pre-push` (lint, typecheck, unit tests) in an existing clone; skip it once with `git push --no-verify` |
| `make dev` | Next.js on port 3000. For UI work without a UniFi console, set `UNIFI_MOCK=1` in `.env` first (dummy household; see [docs/setup.md](docs/setup.md)). |
| `make test-unit` | Unit tests; no database needed |
| `make test` | Unit tests, then integration tests (PostgreSQL, always the `familyfi_test` database) |
| `make test-coverage` | Unit and integration tests in one run; fails below the coverage floors |
| `make test-browser` | Production build, then Playwright on desktop and phone, the way CI runs it |
| `make test-api` | OpenAPI lint, and every route and method documented |
| `make test-api-breaking` | Breaking OpenAPI changes against `main` (needs Go) |
| `make test-api-version` | OpenAPI `info.version` is a semver increase over `main` that fits the change |
| `make db-migrate` | Apply migrations to the development database |
| `make db-drift` | Fail when `schema.prisma` differs from what the migrations build (run after `db-migrate`) |
| `make db-upgrade` | Upgrade a filled database from every supported release (or `pnpm db-upgrade --from <tag>` / `--latest`); fail on an error, lost rows or drift, naming the release |
| `make spike` | UniFi integration spike CLI (`SPIKE_ARGS=discover`, `apply`, `disable`, `cleanup`) |
| `make lint` / `make typecheck` / `make build` | Checks and production build |
| `make docker-build` | Build `familyfi:dev` |
| `make docker-dev-up` | Locally built image plus Compose PostgreSQL |
| `make docker-up` | GHCR image plus Compose PostgreSQL |
| `make docker-down` | Stop without deleting volumes |
| `make docker-smoke` | Build `familyfi:dev`, reject `designs/` in the image, run health/login against bundled-style external Postgres |

The container smoke runs on pull requests but not on pushes to `main` (image builds are slow and costly), and with CI it gates every release: `release.yml` publishes only a `v*` tag on `main` whose commit passes both.

## Pull requests

PRs include tests and, for any `/api/v1` change, an OpenAPI update in the same change. The PR description explicitly lists every issue or alert it closes; use `Closes #<number>` for GitHub issues and identify security alerts by their Dependabot alert number and advisory.

## OpenAPI consumer coordination

- Whenever a change modifies the OpenAPI specification, open an issue in `familyfi-ios` for the iOS client to adopt that contract change. Describe the affected endpoints and schemas, the expected client work, and any rollout or compatibility considerations.
- Assess every requested contract change for compatibility. If the requested change would be breaking, call that out clearly before making the change. The human operator—not the agent—decides whether the breaking change is warranted or whether a compatible approach is needed; do not make that product decision on the operator's behalf.
- Do not raise a breaking-change warning for additive or otherwise compatible contract changes. The agent's role is to identify a breaking impact when the requested work would cause one, not to speculate about or independently choose breaking changes.
- The `OpenAPI` workflow enforces this on every pull request that changes `openapi/`: a breaking change against `main` fails it until the operator adds the `breaking-api` label. Never add that label yourself; it records the operator's decision.

**A PR built from a plan carries that plan in its description, in full and verbatim.**
Put it in a collapsed `<details>` block so it does not bury the summary. A plan records
the decisions the work was approved on, and a reviewer cannot judge a diff against a plan
they cannot see — so it belongs on the PR, not in a chat log that closes with the session.

Follow it with what shipped differently. Plans are written before the work and the work
teaches you things; a plan presented as if it all held is worse than no plan at all. Say
what changed and why — the deviations are usually the most interesting part of the review.

Keep the description current with the branch. A body written for the first commit is
stale the moment the second one lands, and a stale description is read as the truth.

## Further reading

- [docs/testing.md](docs/testing.md) — what to run, test rules, what CI checks
- [docs/architecture.md](docs/architecture.md) — desired-block formula, reconciliation, UniFi client
- [docs/setup.md](docs/setup.md) — environment variables and auth
- [docs/operations.md](docs/operations.md) — backup, outages, upgrades
- [docs/api.md](docs/api.md) — `/api/v1` and OpenAPI
- [docs/licensing.md](docs/licensing.md), [CONTRIBUTING.md](CONTRIBUTING.md)
