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
- **The prefix marks public surface, not ownership.** It belongs on variables an operator sets to run a real deployment — the ones documented in `.env.example`, the README and `docs/`, where a name like `DEFAULT_PASSWORD` would be ambiguous in a shared shell or a Compose file. Two kinds of variable take no prefix: those configuring an external system, which keep that system's convention (`POSTGRES_*`, `DB_*`, `UNIFI_API_KEY`, `GITHUB_*`, and framework contracts like `DATABASE_URL`, `PORT`, `NODE_ENV`); and development-, test- or CI-only flags, which are never part of a deployment. `UNIFI_MOCK`, `KILL_PORT`, `SKIP_DB_PREPARE`, `CLOUDFLARED_BIN` (tests only: a stand-in `cloudflared`), and `BASE_REF` and `BREAKING_API_APPROVED` (the OpenAPI checks' base branch and `breaking_api` label) are the second kind — ours, but local or internal plumbing, so they stay bare. Today that leaves `FAMILYFI_DEFAULT_PASSWORD`, `FAMILYFI_SESSION_SECRET`, `FAMILYFI_ENCRYPTION_KEY`, `FAMILYFI_PORT`, `FAMILYFI_IMAGE` and `FAMILYFI_PHONE_GATEWAY_PORT` as the whole prefixed set.
- **Renaming an env var is breaking.** The value must move with the name. `FAMILYFI_ENCRYPTION_KEY` in particular: a fresh key makes the stored UniFi API key undecryptable and Sync fails with "Unsupported state or unable to authenticate data".
- **Renaming a model is a migration, not a schema edit.** `ALTER ... RENAME` the table, enums, columns, constraints and indexes in place so existing databases upgrade. Constraints keep their old generated names through a table rename — bring them along, then run `make db-migrate db-drift db-upgrade`. `prisma migrate status` checks migration history; `db-drift` compares the database with the schema. Never rewrite an already applied migration to rename an object.
- **Internal naming has no legacy carve-out.** Remove obsolete internal aliases when their callers have migrated. This does not authorize breaking an HTTP contract, discarding persisted data, editing applied migrations or regenerating deployment secrets; follow the migration and API compatibility rules. A policy is ours when its id and creation evidence are on record for this console and site — never because of its name, `FamilyFi ` or any other.

## Design system and interactions

This section is the maintained web design guide. It should be sufficient alongside tracked source
for UI work in a fresh clone; local `designs/` exports are optional references. A new design decision
needed for future work belongs here when implemented, not only in a canvas or session transcript.

### Design ownership

| Concern | Authoritative location |
| --- | --- |
| Web colour, typography and spacing tokens | [globals.css](../src/app/globals.css); font loading in [layout.tsx](../src/app/layout.tsx) |
| Reusable controls and marks | [src/components/ui](../src/components/ui); compose these before introducing a new primitive |
| Brand artwork and its composition | [public/brand](../public/brand) and [Logo.tsx](../src/components/ui/Logo.tsx) |
| Access labels, schedules and actions | [display.ts](../src/lib/display.ts), [group-actions.ts](../src/components/group-actions.ts), [pause-sheet.ts](../src/lib/pause-sheet.ts) and [shared vectors](testing.md#display-vectors) |
| Rule and resolver verdicts | [rules.ts](../src/lib/rules.ts), [upstream.ts](../src/lib/upstream.ts) and [architecture](architecture.md#upstream-dns-categories) |
| Native typography, navigation and adaptive layout | [Native design guide](https://github.com/nickberardi/familyfi-ios/blob/main/docs/design-system.md); read its current sources for platform details |

Shared meaning must survive platform adaptation: Pause suspends enforcement, protection cannot be
bypassed, time follows the household timezone, and unknown observations remain unknown. Native
controls, fonts and navigation can differ; web CSS dimensions are not a native layout specification.
Record deliberate web choices here and native choices there, with links rather than mirrored claims.

### Interaction rules

- Present the household task and its result in plain language. Keep gateway implementation details in diagnostic views where they help an operator act.
- Reuse the shared action and display functions so cards, details and sheets agree on labels and available actions. Do not infer actions from colour or duplicate schedule calculations in a component.
- Show saved configuration separately from enforcement progress. Use the existing mutation feedback and per-action change tracking described in [key flows](architecture.md#key-flows).
- Distinguish initial loading, an empty household, a failed request and an unknown measurement. A retained result after a failed refresh is not evidence of a fresh observation.
- Preserve keyboard access, accessible names and visible focus when composing controls. Verify desktop and phone layouts, including relevant loading, empty, pending and failure states.

The Devices list leads with the observed connection status and links each identity to a read-only detail page. The detail page leads with a named presence state and connection summary, then groups identity and connection fields into two cards that stack on narrow screens. Assignment remains a separate control on the list. Last-known status names the checked time; it never looks like a fresh online result.

### Styling

- Accessibility: contrast at least 4.5:1; no text under 14px rendered below 0.7 alpha. `tests/unit/mark-contrast.test.ts` checks colour tokens and `tests/browser/accessibility.spec.ts` runs axe (WCAG 2.1 A and AA) on every page in both viewports, with no exceptions.
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

What to run before a pull request, the rules tests follow, and what CI checks are in [testing.md](testing.md).

| Target | Behavior |
| --- | --- |
| `make setup` | Install, create `.env` if missing, start the dev database when Docker is available, migrate, and turn on the pre-push hook |
| `make hooks` | Turn on `.githooks/pre-push` (lint, typecheck, unit tests) in an existing clone |
| `make dev` | Next.js on port 3000. For UI work without a UniFi console, set `UNIFI_MOCK=1` in `.env` first (dummy household; see [setup.md](setup.md)). |
| `make ci` | `scripts/ci.sh`: the CI workflows' jobs on this machine, each with a disposable PostgreSQL (`CI_ARGS=--quick` for verify and container) |
| `make release` | `scripts/release.sh`: CI, then build, push and publish a release from this machine (`RELEASE_ARGS="--tag vX.Y.Z"`) |
| `make test-unit` | Unit tests; no database needed |
| `make test` | Unit tests, then integration tests (PostgreSQL, always the `familyfi_test` database) |
| `make test-coverage` | Unit and integration tests in one run; fails below the coverage floors |
| `make test-browser` | Production build, then Playwright on desktop and phone, the way CI runs it |
| `make test-api` | OpenAPI lint, and every route and method documented |
| `make test-api-breaking` | Breaking OpenAPI changes against `main` (needs Go) |
| `make test-api-version` | OpenAPI `info.version` is a semver increase over `main` that fits the change |
| `make test-mutation` | Mutation testing of the enforcement code; a report, never a gate |
| `make db-migrate` | Apply migrations to the development database |
| `make db-drift` | Compare the configured database with `schema.prisma` and fail on drift (run after `db-migrate`) |
| `make db-upgrade` | Upgrade a filled database from every supported release (or `pnpm db-upgrade --from <tag>` / `--latest`); fail on an error, lost rows or drift, naming the release |
| `make spike` | UniFi integration spike CLI (`SPIKE_ARGS=discover`, `apply`, `disable`, `cleanup`) |
| `make lint` / `make typecheck` / `make build` | Checks and production build |
| `make docker-build` | Build `familyfi:dev` |
| `make docker-dev-up` | Locally built image plus Compose PostgreSQL |
| `make docker-up` | GHCR image plus Compose PostgreSQL |
| `make docker-down` | Stop without deleting volumes |
| `make docker-smoke` | Build `familyfi:dev`, reject `designs/` in the image, run health/login against bundled-style external Postgres |

The container smoke runs on pull requests but not on ordinary pushes to `main`. For an unpublished release tag on `main`, `release.yml` requires CI and container smoke before building images. If the image tag already exists, the workflow skips those jobs and publishing; the local release path runs `ci.sh --quick` by default. See [operations](operations.md#releases) and [scripts](../scripts/README.md#releasesh).
