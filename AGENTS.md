<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# FamilyFi agent notes

Shared instructions for Codex, Claude Code and contributors. `CLAUDE.md` imports this file. Product documentation starts at [README.md](README.md).

## Start here each session

1. Read this file, inspect `git status`, and establish the requested outcome and existing work.
2. Read the [system map and key flows](docs/architecture.md#system-map) through the feature map before choosing where to change code. Follow the detailed sections relevant to the task.
3. Use the task table below to read design, contract and validation guidance. Trace the relevant implementation, callers and tests; a previous session's summary is not a substitute for the current checkout.

### Product context

FamilyFi lets a household manage internet access for people and groups of things through its
UniFi gateway. Administrators use rules (all internet, categories, apps or websites, always or in named windows), pauses, allowances and device assignment,
and configure the gateway, accounts and companion connections; only administrators use FamilyFi. DNS category
reports describe filtering observed through a resolver; they do not enforce it.

This repository owns the web UI, server, database, HTTP contract and shared display fixtures.
The native companion lives in [familyfi-mobile](https://github.com/nickberardi/familyfi-mobile): an Expo app for iPhone, iPad, Apple Watch
and Android that imports this repository through its `vendor/familyfi` submodule.
Read that repository's instructions and implementation for its current screens and platform
choices; do not maintain a copy of its implementation status here. Clients share household
semantics and the API, while each platform owns its presentation.

A **Group** holds network controls for a person (`family`) or collection of equipment (`things`).
A **Rule** blocks all internet, a category, apps or websites for one or more groups, always or in
named **windows**; each window is one UniFi policy. An internet rule is optional.
An **Account** is a login and may be linked to a group; a family member card does not imply a login.
A **Device** is a discovered network client; a **PairedDevice** is a phone, Watch or agent authorized to
call the API. A **ChangeResult** tracks an enforcement request; a **SyncRun** tracks a reconciliation
pass. Keep these distinctions when naming features and choosing data owners.

## Working agreement

1. Inspect the working tree and read the relevant implementation, callers and tests before editing. Preserve work that belongs to someone else.
2. For changes spanning behaviour or module boundaries, state the intended outcome, affected areas and validation before implementation. Small, clear fixes can proceed directly. Keep a durable plan for work that spans sessions; record decisions and deviations.
3. Make the smallest complete change that satisfies the request. Reuse existing behaviour and primitives. Avoid speculative abstractions, dependencies and configuration. Read [development conventions](docs/development.md#implementation-and-review) before code changes.
4. Write a regression test for a bug and observe it fail for the reported reason. Run focused checks while iterating, then the applicable checks in [testing.md](docs/testing.md). Do not weaken tests, coverage, types or lint rules to make a change pass.
5. Review the final diff for correctness, unnecessary complexity, stale documentation and unintended changes. Report what changed, the commands run and their results, and any remaining uncertainty. Never describe an unrun check as passed.

## Read for your task

| Task | Read before editing |
| --- | --- |
| Code or naming | [Implementation and review](docs/development.md#implementation-and-review), [naming](docs/development.md#naming) when adding or renaming symbols, relevant tests |
| Enforcement, schedules, DNS or server boundaries | [Architecture](docs/architecture.md) |
| UI | [Design system and interactions](docs/development.md#design-system-and-interactions), existing `src/components/ui` primitives, local `designs/` references when present |
| HTTP contract or authentication | [API](docs/api.md), `openapi/familyfi.v1.yaml`, authorization matrix in `tests/integration/authorization-matrix.test.ts` |
| Database, environment or deployment | [Setup](docs/setup.md), [operations](docs/operations.md), [naming and migration rules](docs/development.md#naming) |
| Tests, CI or scripts | [Testing](docs/testing.md), [scripts](scripts/README.md) |

For UI references, read `Web Design.dc.html`, `Sign In.dc.html`, and the `_ds/` bundle's `readme.md`, `tokens/` and `_ds_bundle.js` when available. They are optional local references, never dependencies. Repository rules, current components and tokens, and architecture take precedence over prototype behaviour, sizes, colours and delivery mechanisms. Missing `designs/` does not block UI work.

## Repository skills

- [Validate a change](.agents/skills/validate-change/SKILL.md): select and run checks before handoff or reproduce a CI failure.
- [Release](.agents/skills/release/SKILL.md): prepare or publish a release when requested by the operator.

All repository skills live in `.agents/skills/`. `.claude/skills` is a directory symlink to it, so new skills are automatically shared with Claude Code. Add and edit skills only under `.agents/skills/`; maintain one definition per workflow. Skills reference the existing docs and scripts; they do not replace the rules below.

## Stack and layout

Next.js App Router + TypeScript, React, Tailwind, Prisma/PostgreSQL. `src/app` holds pages and routes; `src/components` web UI; `src/ui` components shared with the native app (React Native primitives, rendered on the web through react-native-web); `src/server` database, authentication and enforcement; `src/lib` client-safe types and pure logic. `prisma` owns schema and migrations, `openapi` the HTTP contract, `tests` validation, `scripts` tooling and startup, and `docker` deployment.

Use `make setup` for a new development environment, `make dev` to run it, and `make lint typecheck test-unit` for fast code checks. Tests and checks run through `scripts/test.py` (Python 3.11+), which the `make` test targets alias; it selects by test, category, layer or platform and owns a fresh database per run. Setup and dev can migrate the development database; tests never do. The complete [command reference](docs/development.md#commands) explains side effects; [testing.md](docs/testing.md) selects checks by change.

## Invariants

Each invariant names the tests that enforce it; `tests/unit/invariants.test.ts` fails when one names none, or names a file that does not exist. A new invariant comes with its tests.

- One deployment serves one household. Desired state is in PostgreSQL; UniFi firewall policies are enforcement only. *Tests:* `tests/integration/reconcile.test.ts`, `tests/integration/reconcile-properties.test.ts`.
- Never modify, disable, delete, or reorder administrator-created policies. Never call the UniFi policy ordering PUT. Own policies by recorded IDs and creation evidence for this console and site, never by name: names may one day be chosen by the operator, and an administrator's policy can carry any name. Every client `clientForHousehold` hands out goes through `src/server/unifi/policy-ownership.ts`, which refuses to update or delete any policy not on record, whichever code path supplies the id. *Tests:* `tests/integration/policy-ownership.test.ts`, `tests/integration/reconcile-properties.test.ts`, `tests/unit/unifi.test.ts`.
- All UniFi calls are server-side. Do not put keys or UniFi clients in the browser. `tests/unit/client-boundary.test.ts` fails when a `"use client"` file, a `src/lib` module or a shared `src/ui` component reaches `src/server` or a server-only package, even through other modules. *Tests:* `tests/unit/client-boundary.test.ts`.
- Every `/api/v1` route and method declares who may call it — anonymous, a member, an administrator, the recovery account, a caller over the tunnel without a paired phone, or a paired device with each scope — in the authorization matrix. A route the matrix does not name fails the suite, and so does a guard that widens or narrows access without the table changing with it. *Tests:* `tests/integration/authorization-matrix.test.ts`.
- FamilyFi never holds the Docker socket. Installing a release goes through the Watchtower sidecar in `docker/docker-compose.yml`, which alone mounts it, publishes no port, polls nothing on its own and updates only the app, after the app's backup hook. Its token is generated by FamilyFi into the updater volume before either starts, and Watchtower reads it from there read-only. *Tests:* `tests/unit/compose-updater.test.ts`, `tests/integration/update-api.test.ts`.
- Do not create UniFi Object Manager groups. Operators paste an Integration API key in Settings; FamilyFi encrypts it with `FAMILYFI_ENCRYPTION_KEY`. *Tests:* `tests/unit/unifi-client-surface.test.ts`, `tests/integration/unifi-key-storage.test.ts`, `tests/unit/crypto.test.ts`.
- `FAMILYFI_MODE` is the one switch for the kind of work a process does: `prod` (the default: a real gateway on PostgreSQL), `dev` and `test` (the UniFi mock and the seed household, on PostgreSQL or, with `DB_MODE=memory`, in memory), and `demo`. Never treat the mock as enforcement. Under `NODE_ENV=production` only `prod` and `demo` start, and `test` only under CI; any other mode stops startup and reads as `prod` until then. `prod` never runs on the in-memory database. `UNIFI_MOCK` is no longer read. `scripts/runtime/mode.mjs` is the startup scripts' copy and must read every setting the same. *Tests:* `tests/unit/familyfi-mode.test.ts`, `tests/unit/unifi-mock.test.ts`.
- `FAMILYFI_MODE=demo` is the hosted public demo: the UniFi mock and the seed household, even in production, on an in-memory PGlite database that `scripts/runtime/memory-database.mjs` serves on loopback. In demo mode the database is always that one, whatever is configured, so nothing is kept between starts and no real gateway or database is reached; it never opens a Cloudflare tunnel from its host. Every visitor shares one household, so configuration writes (settings, accounts, resolvers, connection routes and their certificate pins, remote access, the home network address, installing updates and their schedule, household export and import) answer 403 `demo_locked`. *Tests:* `tests/unit/familyfi-mode.test.ts`, `tests/unit/demo-boot.test.ts`, `tests/integration/demo-lock.test.ts`.
- A group's pause blocks all internet for it now: the verb `pause` on its built-in `internet` rule (`POST /groups/{id}/rules/internet/pause`) enables a hidden always-on block rule, one unscheduled policy that exists only while the group is paused. An allowance, `allow` on `internet`, lifts each of the group's internet rules until a time by leaving its devices out of those policies; category, app and website rules still apply. A rule pause or rule allow lifts a rule for every group it covers until a time by disabling its policies, which stay on the gateway; either can instead apply to one group, whose devices leave the rule's policies. Like these they end on a one-off expiry, never at a window edge. The verbs mean the same at every scope: pause, resume and extend act on a pause, allow and disallow on an allowance. Quarantine is the built-in rule `quarantine`: its switch is `quarantineEnforced`, a pause disables the quarantine policies in place, and it is never edited, deleted or allowed. Recurring windows are UniFi policy `schedule`s, one policy per window, never clock-driven enable/disable at window edges. *Tests:* `tests/integration/reconcile-properties.test.ts`, `tests/unit/plan-rules.test.ts`, `tests/unit/rule-windows.test.ts`, `tests/integration/rules-api.test.ts`.
- Unassigned devices are **quarantined** in the API and tests; the Devices UI may say **Unassigned**. Discovery and quarantine only include clients on managed VLANs. *Tests:* `tests/integration/reconcile.test.ts`, `tests/integration/reconcile-properties.test.ts`, `tests/integration/quarantine-observe.test.ts`.
- Remote access tunnels point only at the phone-only gateway (`src/server/tunnel/phone-gateway.ts`), never at the web app. The gateway passes `/api/v1/*` only, strips cookies, and stamps `x-familyfi-via: tunnel`. Its remote access port (`FAMILYFI_REMOTE_ACCESS_PORT`, published by the Compose file) closes every connection unanswered unless Remote access publishes a route the household runs; nobody signs in with a password over a tunnel; phones and Watches join by their invite claim and renew with their refresh token. `cloudflared` is pinned and hash-checked in the image, never downloaded at runtime. *Tests:* `tests/unit/phone-gateway.test.ts`, `tests/integration/remote-access.test.ts`, `tests/integration/connection-api.test.ts`, `tests/integration/authorization-matrix.test.ts`.
- A Cloudflare Access service token is handed only to phones: in the pairing code, the claim's signed manifest, and the signed manifest of a paired device's session. It is stored encrypted, and never appears in `/connection/identity`, the endpoints list, a browser session's `GET /connection`, or logs; the phone gateway strips the `CF-Access-Client-*` headers before the app sees them. Only an `own` route with `transport: cloudflare` may carry one, and `ConnectionTransport` never gains a value for it: phones decode `transport` as a closed enum. *Tests:* `tests/integration/edge-auth.test.ts`, `tests/unit/phone-gateway.test.ts`.
- A paired device's bearer lives one hour and is renewed only with its rotating refresh token, which lasts 90 days from its last use. Both are one `Session` row, so revoking the device, signing out or a password change ends them together. The refresh token just replaced is honoured once within seconds, for a lost response; any later use of it ends that sign-in. Older tokens are simply invalid. Browser cookie sessions have no refresh token. *Tests:* `tests/integration/session-refresh.test.ts`, `tests/integration/authorization-matrix.test.ts`.
- Every paired device joins through `/api/v1/paired/invites` and is managed through `/api/v1/paired/devices`. Pairing is the authentication: an invite names the account its device acts as, a claim answers every client the same way (its device, bearer and refresh token, never a password or device credential), and password sign-in is for browsers only. `?claim=true` serves only a signed-in paired phone creating its Watch, so no browser ever receives another device's tokens. *Tests:* `tests/integration/paired-invites.test.ts`, `tests/integration/paired-devices.test.ts`, `tests/integration/watch-device-api.test.ts`, `tests/integration/authorization-matrix.test.ts`.
- Only administrators use FamilyFi. An adult without administrator access is like a child or teen: no sign-in (403 `administrator_account_required`), no session, no paired device, and no invite claim; demoting an administrator ends their sessions and removes their paired devices and pending invites, and a session or refresh left over for one is refused. *Tests:* `tests/integration/auth-api.test.ts`, `tests/integration/session-refresh.test.ts`, `tests/integration/paired-invites.test.ts`, `tests/integration/paired-devices.test.ts`, `tests/integration/authorization-matrix.test.ts`.
- Every paired device has a scope, and each (client, scope) pair — `phone:full`, `watch:rulesOnly`, `agent:full`, `agent:readOnly`, and no others — is one explicit allowlist in `src/server/device-scope.ts`, never a ladder. The scope bounds the device, never the account it acts as, which is always an administrator. Every `/api/v1` route in the authorization matrix names which device scopes may call it. An agent never is an administrator, never reaches accounts, UniFi settings, resolvers or connection management, never changes household settings, never receives a Cloudflare Access token, and is refused through FamilyFi's remote access tunnel. It never sends a password: it claims its pairing code once, at the pairing claim, and renews with its rotating refresh token; it is refused through the tunnel at its claim and refresh too. *Tests:* `tests/unit/device-scope.test.ts`, `tests/integration/agent-pairing.test.ts`, `tests/integration/watch-device-api.test.ts`, `tests/integration/authorization-matrix.test.ts`.
- Upstream DNS categories are reporting only — they never create a UniFi policy, so their routes return no `change` and never enqueue reconciliation. `src/lib/upstream-domains.ts` is a seed reconciled into the database at boot, not runtime data; the probe reads the database. A verdict of `unknown` means we could not look, and must never be shown or stored as `open`. *Tests:* `tests/integration/upstream-checks-api.test.ts`, `tests/integration/upstream-categories-api.test.ts`, `tests/unit/upstream-domain-verdict.test.ts`, `tests/integration/upstream-seed.test.ts`.
- Do not commit `/designs/`, `.env`, UniFi keys, or unsanitized household API dumps. `designs/` is local-only UI reference; public code must not import from it. *Tests:* `tests/unit/repository-hygiene.test.ts`.

## Resource and change safety

- Track worktrees, temporary directories, servers and containers created for this task. Use `trap` or `finally` for cleanup. Stop only resources this task started.
- Before a large build, check free disk space. Below 20 GiB, clean this task's disposable output first or report the shortage. At completion remove disposable output no longer needed for review; report retained large artifacts with path and size.
- Never delete another task's worktree, shared cache, Docker volume, simulator or model data. Remove a task-created worktree only when inactive and its status confirms no work will be lost; use the environment's managed-worktree tool when applicable, otherwise `git worktree remove`. Leave the current checkout in place.
- Never run `scripts/ci/runner-cleanup.sh` on a development machine; it removes shared Docker and cache data.
- Live UniFi writes, publishing and deployment require the user's request. A test or release checklist is not authorization to change a household gateway or publish a release.
- Do not bypass checks with `--no-verify`, `--skip-ci`, `--allow-dirty`, `--force`, `--breaking-api` or `BREAKING_API_APPROVED` unless the operator explicitly authorized that exception. Report any exception and its missing evidence.

## Pull requests

PRs include validation appropriate to the change. Behaviour changes include tests; API contract changes include an OpenAPI update in the same change. An internal refactor with unchanged HTTP behaviour does not require a spec edit or version bump. The PR description explicitly lists every issue or alert it closes; use `Closes #<number>` for GitHub issues and identify security alerts by their Dependabot alert number and advisory.

**Before opening a PR, spawn the `reviewer` subagent** (`.claude/agents/reviewer.md` for Claude, `.codex/agents/reviewer.toml` for Codex) with the plan or issue the change was built from. Fix every blocking finding, then spawn a fresh reviewer again, until it reports none. The agent that wrote a change never reviews it. The reviewer is two files only because Claude and Codex define subagents in different formats; `tests/unit/reviewer-agents.test.ts` keeps their instructions identical, so edit both together rather than merging them into a skill.

## OpenAPI consumer coordination

- Whenever a change modifies the OpenAPI specification, open an issue in `familyfi-mobile` for the companion app to adopt that contract change. Describe the affected endpoints and schemas, the expected client work, and any rollout or compatibility considerations.
- Assess every requested contract change for compatibility. If the requested change would be breaking, call that out clearly before making the change. The human operator—not the agent—decides whether the breaking change is warranted or whether a compatible approach is needed; do not make that product decision on the operator's behalf.
- Do not raise a breaking-change warning for additive or otherwise compatible contract changes. The agent's role is to identify a breaking impact when the requested work would cause one, not to speculate about or independently choose breaking changes.
- The `OpenAPI` workflow enforces this on every pull request that changes `openapi/`: a breaking change against `main` fails it until the operator adds the `breaking_api` label. Never add that label yourself; it records the operator's decision.

## Plans in pull requests

**A PR built from a plan carries that plan in its description, in full and verbatim.**
Put it in a collapsed `<details>` block so it does not bury the summary. A plan records
the decisions the work was approved on, and a reviewer cannot judge a diff against a plan
they cannot see — so it belongs on the PR, not in a chat log that closes with the session.

Follow it with what shipped differently. Plans are written before the work and the work
teaches you things; a plan presented as if it all held is worse than no plan at all. Say
what changed and why — the deviations are usually the most interesting part of the review.

Keep the description current with the branch. A body written for the first commit is
stale the moment the second one lands, and a stale description is read as the truth.
