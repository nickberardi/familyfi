# Setup

FamilyFi is one Next.js application (web/PWA plus `/api/v1`) and PostgreSQL. UniFi credentials are stored encrypted in the database, not in environment variables, after you paste a key in Settings.

## Environment

Copy `.env.example` to `.env` and set:

| Variable | Purpose |
| --- | --- |
| `DEFAULT_PASSWORD` | Password for username `admin`. Generated on first setup if missing. Printed in the server log at every startup. Change it in `.env` to pick your own; the new value is used on the next `admin` sign-in. |
| `SESSION_SECRET` | Binds cookie sessions. Generated on first setup if missing or invalid; never rotated automatically afterward. |
| `APP_ENCRYPTION_KEY` | Encrypts the UniFi API key at rest. Generated on first setup if missing or invalid. Back this up with the database; rotating it makes a stored UniFi key unreadable. |
| `DB_MODE` | `bundled` (app + PostgreSQL via `docker/docker-compose.yml`) or `external` (use `DB_HOST` below). |
| `DB_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Connection parts. Prisma `DATABASE_URL` is derived, with credentials URL-encoded. Do not treat a hand-written `DATABASE_URL` as source of truth. |
| `DB_SSL_MODE`, `DB_SSL_ROOT_CERT` | Optional TLS for external PostgreSQL (`require`, `verify-full`, …). |

Do not set a runtime `UNIFI_API_KEY` for the web app. The spike CLI may use a temporary key; that path is not the application credential store.

## Local development

1. Install Node.js 20+ and pnpm 10.
2. Install Docker if you want `make setup` to start PostgreSQL for you.
3. `cp .env.example .env` and set `POSTGRES_PASSWORD`. Recovery password and crypto secrets are written into `.env` on first setup if they are missing. Watch the server log for `username: admin` and `password:`.
4. `make setup` then `make dev`. `make dev` waits for PostgreSQL, applies pending Prisma migrations, regenerates the database client, then starts Next. The first start can take a few extra seconds. If port 3000 is already taken, `make dev` asks whether to kill that process.
5. Open http://localhost:3000 and sign in as `admin`.

`make setup` will not overwrite an existing `.env`.

If Docker is unavailable, run PostgreSQL yourself, point `DB_*` at it, then `make db-migrate`.

Phones on the LAN should use the host's LAN address, not `localhost`. HTTPS is required for a deployed PWA and for secure cookies in production.

## Authentication

- Username `admin` is reserved and cannot be removed through household administration.
- Adults granted admin access get personal usernames and passwords. Those names cannot be `admin`.
- Children, teens, and Things groups do not receive logins.
- Browser sessions use an httpOnly cookie plus a CSRF cookie. Native clients call `POST /api/v1/auth/login` with `"client": "native"` and send `Authorization: Bearer`.
- Five failed attempts in 15 minutes, per username or IP, are rejected with HTTP 429.
- Sessions last 30 days unless revoked (password change, access removal, or logout).

Email magic links and self-serve email reset from the sign-in prototype are not implemented. Create personal adult accounts with `POST /api/v1/accounts` (adult Family group only). Recovery `admin` cannot be removed; change its password via `DEFAULT_PASSWORD` in `.env`.

## UniFi connection (application)

Paste the Network Integration API key in Settings (`PUT /api/v1/settings/unifi`). The app encrypts it with `APP_ENCRYPTION_KEY`. For a local console with a private CA, send `tlsInsecure: true`. Choose `manageAllNetworks: true` or `managedNetworkIds: ["…"]` so discovery/quarantine only watch those VLANs; the default is none until you pick. The spike CLI env key is not used by the running app.
