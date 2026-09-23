<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# FamilyFi agent notes

Human-facing product docs live in [README.md](README.md) and `docs/`. This file is for coding agents and contributors working in the repo.

## Invariants

- One deployment serves one household. Desired state is in PostgreSQL; UniFi firewall policies are enforcement only.
- Never modify, disable, delete, or reorder administrator-created policies. Never call the UniFi policy ordering PUT. Own policies by recorded IDs and creation evidence, not a `FamilyFi ` name prefix alone.
- All UniFi calls are server-side. Do not put keys or UniFi clients in the browser. `tests/unit/client-boundary.test.ts` fails when a `"use client"` file or a `src/lib` module reaches `src/server` or a server-only package, even through other modules.
- Do not create UniFi Object Manager groups. Operators paste an Integration API key in Settings; FamilyFi encrypts it with `FAMILYFI_ENCRYPTION_KEY`.
- `UNIFI_MOCK=1` is local-only dummy UniFi plus a seeded household for UI work. Never treat it as enforcement. It is ignored when `NODE_ENV=production`.
- Pause suspends schedule enforcement (`enabled: false` on app-owned policies, schedule preserved). Resume is `enabled: true`; bedtime may still block. Recurring bedtime is the UniFi policy `schedule`, not clock-driven enable/disable at window edges.
- Protection is per group. Do not expose controls that bypass protection.
- Unassigned devices are **quarantined** in the API and tests; the Devices UI may say **Unassigned**. Discovery and quarantine only include clients on managed VLANs.
- Remote access tunnels point only at the phone-only gateway (`src/server/tunnel/phone-gateway.ts`), never at the web app. The gateway passes `/api/v1/*` only, strips cookies, and stamps `x-familyfi-via: tunnel`; over a tunnel, sign-in requires a paired phone checked before the password. `cloudflared` is pinned and hash-checked in the image, never downloaded at runtime.
- Upstream DNS categories are reporting only — they never create a UniFi policy, so their routes return no `change` and never enqueue reconciliation. `src/lib/upstream-domains.ts` is a seed reconciled into the database at boot, not runtime data; the probe reads the database. A verdict of `unknown` means we could not look, and must never be shown or stored as `open`.
- Do not commit `/designs/`, `.env`, UniFi keys, or unsanitized household API dumps. `designs/` is local-only UI reference; public code must not import from it.

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

Before UI work, read local `designs/` (`Web Design.dc.html`, `Sign In.dc.html`, and the `_ds/` design-system bundle: `readme.md`, `tokens/`, `_ds_bundle.js`) when present. This file and [docs/architecture.md](docs/architecture.md) override prototype logic (including “Pause blocks internet”). Accessibility: contrast at least 4.5:1; no text under 14px rendered below 0.7 alpha. Do not click live UniFi writes unless the operator asked.

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
- **The prefix marks public surface, not ownership.** It belongs on variables an operator sets to run a real deployment — the ones documented in `.env.example`, the README and `docs/`, where a name like `DEFAULT_PASSWORD` would be ambiguous in a shared shell or a Compose file. Two kinds of variable take no prefix: those configuring an external system, which keep that system's convention (`POSTGRES_*`, `DB_*`, `UNIFI_API_KEY`, and framework contracts like `DATABASE_URL`, `PORT`, `NODE_ENV`); and development- or test-only flags, which are never part of a deployment. `UNIFI_MOCK`, `KILL_PORT`, `SKIP_DB_PREPARE` and `CLOUDFLARED_BIN` (tests only: a stand-in `cloudflared`) are the second kind — ours, but local or internal plumbing, so they stay bare. Today that leaves `FAMILYFI_DEFAULT_PASSWORD`, `FAMILYFI_SESSION_SECRET`, `FAMILYFI_ENCRYPTION_KEY`, `FAMILYFI_PORT`, `FAMILYFI_IMAGE` and `FAMILYFI_PHONE_GATEWAY_PORT` as the whole prefixed set.
- **Renaming an env var is breaking.** The value must move with the name. `FAMILYFI_ENCRYPTION_KEY` in particular: a fresh key makes the stored UniFi API key undecryptable and Sync fails with "Unsupported state or unable to authenticate data".
- **Renaming a model is a migration, not a schema edit.** `ALTER ... RENAME` the table, enums, columns, constraints and indexes in place so existing databases upgrade. Constraints keep their old generated names through a table rename — bring them along, then confirm `prisma migrate status` reports no drift.
- **There is no legacy carve-out.** FamilyFi is pre-release, so nothing in the repo exists to stay compatible with an older name. A policy is ours when its name starts with `FamilyFi ` and its id and creation evidence are on record — never by a second, older prefix. If you find yourself adding one, delete the old name instead.

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

`tests/unit/naming.test.ts` fails the build on a raw colour literal, an abbreviated product prefix, a misnamed file, an unprefixed env var of ours, a `var(--ff-…)` reference with no declaration, and a Phosphor class written outside `Icon`. `tests/unit/icons.test.ts` fails it on a glyph name the installed icon font does not have, and `tests/unit/mark-contrast.test.ts` on a verdict pair under the contrast floor. These rules were written down once before and drifted anyway — the tokens existed while 71 literals sat in components — so treat the tests as the contract and this section as their explanation. Extend both together.

## Commands

| Target | Behavior |
| --- | --- |
| `make setup` | Install, create `.env` if missing, start the dev database when Docker is available, migrate |
| `make dev` | Next.js on port 3000. For UI work without a UniFi console, set `UNIFI_MOCK=1` in `.env` first (dummy household; see [docs/setup.md](docs/setup.md)). |
| `make test` | Unit tests, then integration tests against `familyfi_test` |
| `make test-integration` | PostgreSQL + mocked UniFi (never the development `familyfi` database) |
| `make test-api` | OpenAPI lint and route/method contract |
| `make test-browser` | Playwright desktop/phone smoke (`FAMILYFI_DEFAULT_PASSWORD`, running app or CI webServer). In CI a skipped test fails the run: tag a one-viewport test `@desktop` or `@phone`, and a test that cannot run in CI with a tag from `CI_EXCLUDED_TAGS` in `tests/browser-ci-guard.ts` |
| `make spike` | UniFi integration spike CLI (`SPIKE_ARGS=discover`, `apply`, `disable`, `cleanup`) |
| `make lint` / `make typecheck` / `make build` | Checks and production build |
| `make docker-build` | Build `familyfi:dev` |
| `make docker-dev-up` | Locally built image plus Compose PostgreSQL |
| `make docker-up` | GHCR image plus Compose PostgreSQL |
| `make docker-down` | Stop without deleting volumes |
| `make docker-smoke` | Build `familyfi:dev`, reject `designs/` in the image, run health/login against bundled-style external Postgres |

CI: unit, OpenAPI, PostgreSQL integration with mocked UniFi, production build, Playwright. The container smoke runs on pull requests but not on pushes to `main` (image builds are slow and costly), and with CI it gates every release: `release.yml` publishes only a `v*` tag on `main` whose commit passes both. Integration tests use `familyfi_test` and never truncate the development `familyfi` database. Live IPv4 MAC block/restore was proven on a household gateway; IPv6, overnight UniFi scheduler, and a second concurrent MAC are unproven.

## Pull requests

PRs include tests and, for any `/api/v1` change, an OpenAPI update in the same change. The PR description explicitly lists every issue or alert it closes; use `Closes #<number>` for GitHub issues and identify security alerts by their Dependabot alert number and advisory.

## OpenAPI consumer coordination

- Whenever a change modifies the OpenAPI specification, open an issue in `familyfi-ios` for the iOS client to adopt that contract change. Describe the affected endpoints and schemas, the expected client work, and any rollout or compatibility considerations.
- Assess every requested contract change for compatibility. If the requested change would be breaking, call that out clearly before making the change. The human operator—not the agent—decides whether the breaking change is warranted or whether a compatible approach is needed; do not make that product decision on the operator's behalf.
- Do not raise a breaking-change warning for additive or otherwise compatible contract changes. The agent's role is to identify a breaking impact when the requested work would cause one, not to speculate about or independently choose breaking changes.

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

- [docs/architecture.md](docs/architecture.md) — desired-block formula, reconciliation, UniFi client
- [docs/setup.md](docs/setup.md) — environment variables and auth
- [docs/operations.md](docs/operations.md) — backup, outages, upgrades
- [docs/api.md](docs/api.md) — `/api/v1` and OpenAPI
- [docs/licensing.md](docs/licensing.md), [CONTRIBUTING.md](CONTRIBUTING.md)
