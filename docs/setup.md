# Setup

FamilyFi is one Next.js application (web/PWA plus `/api/v1`) and PostgreSQL. UniFi credentials are stored encrypted in the database, not in environment variables, after you paste a key in Settings.

## Environment

Copy `.env.example` to `.env` and set:

| Variable | Purpose |
| --- | --- |
| `DEFAULT_PASSWORD` | Password for the permanent recovery username `admin`. At least 12 characters. The environment value is authoritative; a change takes effect on the next `admin` sign-in. Existing sessions stay valid until expiry or revocation. Never logged or returned by the API. |
| `SESSION_SECRET` | At least 32 characters. Binds cookie-authenticated sessions. |
| `APP_ENCRYPTION_KEY` | 32 bytes as 64 hex characters (or 32-byte base64). Encrypts the UniFi API key at rest. You must back this up with the database; restoring the database without it cannot recover the UniFi key. |
| `DB_MODE` | `bundled` (Compose starts PostgreSQL) or `external`. |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Connection parts. Prisma `DATABASE_URL` is derived, with credentials URL-encoded. Do not treat a hand-written `DATABASE_URL` as source of truth. |
| `DB_SSL_MODE`, `DB_SSL_ROOT_CERT` | Optional TLS for external PostgreSQL (`require`, `verify-full`, …). |

Do not set a runtime `UNIFI_API_KEY`. The spike CLI may use a temporary key; that path is not the application credential store.

## Local development

1. Install Node.js 20+ and pnpm 10.
2. Install Docker if you want `make setup` to start PostgreSQL for you.
3. `cp .env.example .env` and fill the required secrets.
4. `make setup` then `make dev`.
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

Email magic links and self-serve email reset from the sign-in prototype are not implemented. Another admin resets a personal password from Settings (backend phase).
