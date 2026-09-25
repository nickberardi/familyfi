# Setup

FamilyFi is one Next.js application (web/PWA plus `/api/v1`) and PostgreSQL. UniFi credentials are stored encrypted in the database, not in environment variables, after you paste a key in Settings.

## Environment

Copy `.env.example` to `.env` and set:

| Variable | Purpose |
| --- | --- |
| `FAMILYFI_DEFAULT_PASSWORD` | Password for username `admin`. Generated on first setup if missing. Printed in the server log at every startup. Change it in `.env` to pick your own; the new value is used on the next `admin` sign-in. |
| `FAMILYFI_SESSION_SECRET` | Binds cookie sessions. Generated on first setup if missing or invalid; never rotated automatically afterward. |
| `FAMILYFI_ENCRYPTION_KEY` | Encrypts the UniFi API key at rest. Generated on first setup if missing or invalid. Back this up with the database; rotating it makes a stored UniFi key unreadable. |
| `DB_MODE` | `bundled` (app + PostgreSQL via `docker/docker-compose.yml`) or `external` (use `DB_HOST` below). |
| `DB_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Connection parts. Prisma `DATABASE_URL` is derived, with credentials URL-encoded. Do not treat a hand-written `DATABASE_URL` as source of truth. |
| `DB_SSL_MODE`, `DB_SSL_ROOT_CERT` | Optional TLS for external PostgreSQL (`require`, `verify-full`, …). |
| `FAMILYFI_PHONE_GATEWAY_PORT` | Optional. Exposes the phone-only gateway to a tunnel sidecar container on the Compose network (see [Remote access with a sidecar container](#remote-access-with-a-sidecar-container)). Never publish it on the host. |

Do not set a runtime `UNIFI_API_KEY` for the web app. The spike CLI may use a temporary key; that path is not the application credential store.

## Local development

1. Install Node.js 26+ and pnpm 10. `.node-version` names the version CI and the Docker image use; `nvm`, `fnm` and similar tools read it.
2. Install Docker if you want `make setup` to start PostgreSQL for you.
3. `cp .env.example .env` and set `POSTGRES_PASSWORD`. Recovery password and crypto secrets are written into `.env` on first setup if they are missing. Watch the server log for `username: admin` and `password:`.
4. `make setup` then `make dev`. `make dev` waits for PostgreSQL, applies pending Prisma migrations, regenerates the database client, then starts Next. The first start can take a few extra seconds. If port 3000 is already taken, `make dev` asks whether to kill that process.
5. Open http://localhost:3000 and sign in as `admin`.

`make setup` will not overwrite an existing `.env`.

### Dummy household (no UniFi console)

Set `UNIFI_MOCK=1` in `.env` and restart `make dev`. The app fakes the Network Integration API with synthetic fixtures, seeds a small household (Pat / Betsy / Sam / Living Room, three devices), and encrypts the dummy key `mock-unifi-key` so Settings looks connected. Sign in as `admin` or `pat` (same `FAMILYFI_DEFAULT_PASSWORD`). Use this for UI work (adding a user, jittery buttons, layout). Turn the flag off before pointing at a real gateway. Mocks do not prove firewall enforcement.

If Docker is unavailable, run PostgreSQL yourself, point `DB_*` at it, then `make db-migrate`.

Phones on the LAN should use the host's LAN address, not `localhost`. HTTPS is required for a deployed PWA and for secure cookies in production.

## Authentication

- Username `admin` is reserved and cannot be removed through household administration.
- Adults granted admin access get personal usernames and passwords. Those names cannot be `admin`.
- Every adult with a login is trusted with the household: accounts, household settings and the UniFi connection. **Admin** is a flag, not a tier. It gates only phone pairing and remote access (`/api/v1/connection/*`), and any adult can turn it on, their own included. `tests/integration/authorization-matrix.test.ts` holds each route to this.
- Children, teens, and Things groups do not receive logins.
- Browser sessions use an httpOnly cookie plus a CSRF cookie. Native phones must first claim an administrator-generated, five-minute pairing QR (or its manual one-time code), then call `POST /api/v1/auth/login` with `"client": "native"`, `deviceId`, and `deviceCredential`; later requests send `Authorization: Bearer`. A bare server address cannot enroll a phone.
- Five failed attempts in 15 minutes, per username or IP, are rejected with HTTP 429.
- Sessions last 30 days unless revoked (password change, access removal, or logout).

Email magic links and self-serve email reset from the sign-in prototype are not implemented. Create personal adult accounts with `POST /api/v1/accounts` (adult Family group only). Recovery `admin` cannot be removed; change its password via `FAMILYFI_DEFAULT_PASSWORD` in `.env`.

## UniFi connection (application)

Paste the Network Integration API key in Settings (`PUT /api/v1/settings/unifi`). The app encrypts it with `FAMILYFI_ENCRYPTION_KEY`. For a local console with a private CA, send `tlsInsecure: true`. Choose `manageAllNetworks: true` or `managedNetworkIds: ["…"]` so discovery/quarantine only watch those VLANs; the default is none until you pick. The spike CLI env key is not used by the running app.

With `UNIFI_MOCK=1` (never in production), Settings Test/Save talk to the in-process mock. A dummy key of at least 8 characters is enough; the seeded household already uses `mock-unifi-key` and `https://127.0.0.1/proxy/network/integration`.

## Remote access with a sidecar container

The easiest remote access is built in: **System → Pair Device → Remote access** (a quick tunnel, or
FamilyFi's Cloudflare tunnel on your own domain). Use a sidecar instead when you already run
Tailscale, or want a VPN or reverse proxy in front of FamilyFi. Set it up with the wiki guide, then
choose it under **My domain** and enter its HTTPS address:

- [Home network: VPN or reverse proxy](https://github.com/nickberardi/familyfi/wiki/Remote-access-home-network)
  — including an NGINX sidecar next to FamilyFi.
- [Tailscale](https://github.com/nickberardi/familyfi/wiki/Remote-access-Tailscale) — a Tailscale
  Serve sidecar; phones in your tailnet reach `https://familyfi.<your-tailnet>.ts.net`.

Anything reachable from the internet must point at FamilyFi's **phone-only gateway**
(`FAMILYFI_PHONE_GATEWAY_PORT`, for example `http://app:7002`), never the app itself on 7001, which
would put the web admin and its sign-in page on the internet. Never publish the gateway port on the
host. A Cloudflare Tunnel you run yourself (**Cloudflare Tunnel → Advanced**) is coming in
[#69](https://github.com/nickberardi/familyfi/issues/69).

