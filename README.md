# FamilyFi

Family internet controls for a UniFi gateway. One deployment serves one household. Application state is desired configuration; app-owned UniFi firewall policies enforce it. Administrator-created policies are never modified, disabled, deleted, or reordered.

The first client is a responsive web/PWA. The same documented `/api/v1` API is reserved for a later native app.

## Status

Phase 4 verification is in CI: unit, OpenAPI, PostgreSQL integration with mocked UniFi, production build, Playwright, and container smoke. Live IPv4 MAC block/restore is recorded in [docs/spike/RESULTS.md](docs/spike/RESULTS.md). Licensed under the [Business Source License 1.1](LICENSE) ([docs/licensing.md](docs/licensing.md)).

## Requirements

- Node.js 20+
- pnpm 10 (`corepack enable` or `npx pnpm`)
- PostgreSQL 16, either bundled in Compose or external
- Docker, for container runs and the default development database

## Quick start (development)

```bash
cp .env.example .env
# Set DB_PASSWORD. Recovery password and crypto secrets are generated on setup.
make setup
make dev
```

Open http://localhost:3000 and sign in as `admin` with the recovery password printed in the server log.

`DEFAULT_PASSWORD` is the permanent recovery credential. Changing the environment value takes effect on the next `admin` sign-in. Personal adult accounts replace everyday use of `admin`; they do not remove it.

## Docker

```bash
cp .env.example .env
# Set DB_PASSWORD.
# DEFAULT_PASSWORD, SESSION_SECRET, and APP_ENCRYPTION_KEY are generated on first setup if omitted.
# Default DB_MODE=bundled. For an existing server: DB_MODE=external and its DB_* values.
make docker-dev-up   # until a GHCR image exists
# Open http://localhost:7001
make docker-logs
make docker-down     # keeps database volumes
```

After a GHCR release, `make docker-up` pulls `ghcr.io/nberardi/familyfi`.

## Make targets

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

## Documentation

- [Setup](docs/setup.md)
- [Architecture](docs/architecture.md)
- [Operations](docs/operations.md)
- [API](docs/api.md), [`openapi/familyfi.v1.yaml`](openapi/familyfi.v1.yaml), and signed-in **System → API** (`/reference`)
- [Phase 4 verification](docs/verify/PHASE4.md) and [live checklist](docs/verify/LIVE.md)
- [Design review](docs/design-review.md)
- [Plan](docs/plan.md)
- [Spike results](docs/spike/RESULTS.md) and [operator checklist](docs/spike/OPERATOR.md)
- [Licensing](docs/licensing.md)

Private design references in `designs/` are local-only and are excluded from Git and Docker builds.
