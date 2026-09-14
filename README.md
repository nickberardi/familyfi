# FamilyFi

Family internet controls for a UniFi gateway. One deployment serves one household. Application state is desired configuration; app-owned UniFi firewall policies enforce it. Administrator-created policies are never modified, disabled, deleted, or reordered.

The first client is a responsive web/PWA. The same documented `/api/v1` API is reserved for a later native app.

## Status

Phase 0 scaffold: Next.js, PostgreSQL, recovery-admin authentication, OpenAPI for health/auth, Docker/Make paths, and GitHub Actions. Live UniFi enforcement is a Phase 1 gate and is not implemented yet.

## Requirements

- Node.js 20+
- pnpm 10 (`corepack enable` or `npx pnpm`)
- PostgreSQL 16, either bundled in Compose or external
- Docker, for container runs and the default development database

## Quick start (development)

```bash
cp .env.example .env
# Set DEFAULT_PASSWORD, SESSION_SECRET, APP_ENCRYPTION_KEY, and DB_PASSWORD.
make setup
make dev
```

Open http://localhost:3000 and sign in as `admin` with `DEFAULT_PASSWORD`.

`DEFAULT_PASSWORD` is the permanent recovery credential. Changing the environment value takes effect on the next `admin` sign-in. Personal adult accounts replace everyday use of `admin`; they do not remove it.

## Docker

```bash
cp .env.example .env
# Set DEFAULT_PASSWORD, SESSION_SECRET, APP_ENCRYPTION_KEY, and DB credentials.
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
| `make test` | Unit and contract tests |
| `make test-api` | OpenAPI lint |
| `make spike` | UniFi integration spike CLI (Phase 1) |
| `make lint` / `make typecheck` / `make build` | Checks and production build |
| `make docker-build` | Build `familyfi:dev` |
| `make docker-dev-up` | Locally built image, selected database mode |
| `make docker-up` | GHCR image, bundled PostgreSQL by default |
| `make docker-down` | Stop without deleting volumes |
| `make docker-logs` | Follow container logs |

## Documentation

- [Setup](docs/setup.md)
- [Architecture](docs/architecture.md)
- [Operations](docs/operations.md)
- [API](docs/api.md) and [`openapi/familyfi.v1.yaml`](openapi/familyfi.v1.yaml)
- [Design review](docs/design-review.md)
- [Plan](docs/plan.md)
- [Licensing](docs/licensing.md)

Private design references in `designs/` are local-only and are excluded from Git and Docker builds.
