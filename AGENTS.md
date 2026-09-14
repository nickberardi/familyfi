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
- All UniFi calls are server-side. Do not put keys or UniFi clients in the browser.
- Do not create UniFi Object Manager groups. Operators paste an Integration API key in Settings; FamilyFi encrypts it with `APP_ENCRYPTION_KEY`.
- Pause suspends schedule enforcement (`enabled: false` on app-owned policies, schedule preserved). Resume is `enabled: true`; bedtime may still block. Recurring bedtime is the UniFi policy `schedule`, not clock-driven enable/disable at window edges.
- Protection is per group. Do not expose controls that bypass protection.
- Unassigned devices are **quarantined** in the API and tests; the Devices UI may say **Unassigned**. Discovery and quarantine only include clients on managed VLANs.
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

Before UI work, read local `designs/` (`Card System.dc.html`, `Web Design.dc.html`, `Sign In.dc.html`) when present. This file and [docs/architecture.md](docs/architecture.md) override prototype logic (including “Pause blocks internet”). Accessibility: contrast at least 4.5:1; no text under 14px rendered below 0.7 alpha. Do not click live UniFi writes unless the operator asked.

UniFi integration: official Network Integration API with `X-API-KEY`. Local base `https://<console-ip>/proxy/network/integration`; cloud connector `https://api.ui.com/v1/connector/consoles/{consoleId}/proxy/network/integration`. Internet-block action is `BLOCK` (not `REJECT`). Spike CLI: [docs/spike/OPERATOR.md](docs/spike/OPERATOR.md).

## Commands

| Target | Behavior |
| --- | --- |
| `make setup` | Install, create `.env` if missing, start the dev database when Docker is available, migrate |
| `make dev` | Next.js on port 3000 |
| `make test` | Unit tests, then integration tests against `familyfi_test` |
| `make test-integration` | PostgreSQL + mocked UniFi (never the development `familyfi` database) |
| `make test-api` | OpenAPI lint and route/method contract |
| `make test-browser` | Playwright desktop/phone smoke (`DEFAULT_PASSWORD`, running app or CI webServer) |
| `make spike` | UniFi integration spike CLI (`SPIKE_ARGS=discover`, `apply`, `disable`, `cleanup`) |
| `make lint` / `make typecheck` / `make build` | Checks and production build |
| `make docker-build` | Build `familyfi:dev` |
| `make docker-dev-up` | Locally built image, selected database mode |
| `make docker-up` | GHCR image, bundled PostgreSQL by default |
| `make docker-down` | Stop without deleting volumes |
| `make docker-smoke` | Build `familyfi:dev`, reject `designs/` in the image, run health/login against bundled-style external Postgres |

CI: unit, OpenAPI, PostgreSQL integration with mocked UniFi, production build, Playwright, container smoke. Integration tests use `familyfi_test` and never truncate the development `familyfi` database. Live IPv4 MAC block/restore was proven on a household gateway; IPv6, overnight UniFi scheduler, and a second concurrent MAC are unproven.

PRs should include tests and, for any `/api/v1` change, an OpenAPI update in the same change.

## Further reading

- [docs/architecture.md](docs/architecture.md) — desired-block formula, reconciliation, UniFi client
- [docs/setup.md](docs/setup.md) — environment variables and auth
- [docs/operations.md](docs/operations.md) — backup, outages, upgrades
- [docs/api.md](docs/api.md) — `/api/v1` and OpenAPI
- [docs/licensing.md](docs/licensing.md), [CONTRIBUTING.md](CONTRIBUTING.md)
