# Setup

FamilyFi is one Next.js application (web/PWA plus `/api/v1`) and PostgreSQL. UniFi credentials are stored encrypted in the database, not in environment variables, after you paste a key in first-time setup or Settings.

## Environment

Copy `.env.example` to `.env` and set what you need. This is every setting FamilyFi reads; nothing else in the environment changes how it runs.

### The app

| Variable | Default | Purpose |
| --- | --- | --- |
| `FAMILYFI_MODE` | `prod` | `prod`, `dev`, `test` or `demo`; see [Modes](#modes). |
| `FAMILYFI_DEFAULT_PASSWORD` | generated | Password for username `admin`. Generated on first setup if missing. Printed in the server log at every startup. Change it in `.env` to pick your own; the new value is used on the next `admin` sign-in. |
| `FAMILYFI_SESSION_SECRET` | generated | Binds cookie sessions. Generated on first setup if missing or invalid; never rotated automatically afterward. |
| `FAMILYFI_ENCRYPTION_KEY` | generated | Encrypts the UniFi API key at rest. Generated on first setup if missing or invalid. Back this up with the database; rotating it makes a stored UniFi key unreadable. |
| `FAMILYFI_DEMO_URL` | none | `demo` only. The demo's public HTTPS origin, published as the phones' route ([demo mode](operations.md#demo-mode)). |
| `FAMILYFI_PHONE_GATEWAY_PORT` | off | Exposes the phone-only gateway to a tunnel sidecar container on the Compose network (see [Remote access with a sidecar container](#remote-access-with-a-sidecar-container)). Never publish it on the host. |
| `PORT` | `3000` (`7001` in the image) | The port the server listens on. |
| `NODE_ENV` | set by Next.js | `production` under `next start` and in the image. Only `prod` and `demo` start in production, and `test` when `CI` is set. |

The app reads no UniFi settings from the environment; the UniFi key lives in Settings. `UNIFI_MOCK` is no longer read; startup warns when it is set.

### Database

`DB_*` settings are FamilyFi's own choice of database; `POSTGRES_*` settings configure the PostgreSQL it uses.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DB_MODE` | `bundled` | `bundled` (app + PostgreSQL via `docker/docker-compose.yml`), `external` (use `DB_HOST`), or `memory` (an in-memory database, `dev` and `test` only; `demo` always uses it). |
| `DB_HOST` | `127.0.0.1` | PostgreSQL's host for `external`. |
| `POSTGRES_PORT` | `5432` (`5433` in memory) | PostgreSQL's port. In Compose it is only the host's published port; the app container always uses 5432. |
| `POSTGRES_DB`, `POSTGRES_USER` | `familyfi` | Database and user. |
| `POSTGRES_PASSWORD` | none | Required, except in memory. |
| `DB_SSL_MODE`, `DB_SSL_ROOT_CERT` | off | Optional TLS for external PostgreSQL (`require`, `verify-full`, …). |

Prisma's `DATABASE_URL` is derived from these, with credentials URL-encoded. Do not set it by hand or treat a hand-written one as the source of truth.

### Docker Compose

Read by `docker/docker-compose.yml` (and `docker-compose.dev-db.yml`), not by the app.

| Variable | Default | Purpose |
| --- | --- | --- |
| `FAMILYFI_PORT` | `7001` | The host port `make docker-up` publishes. |
| `FAMILYFI_IMAGE` | `ghcr.io/nickberardi/familyfi:latest` | The image `make docker-up` runs. |
| `APP_CONTAINER_NAME`, `POSTGRES_CONTAINER_NAME` | `familyfi-app`, `familyfi-postgres` | Container names. |
| `APP_DATA_VOLUME_NAME`, `POSTGRES_VOLUME_NAME` | `familyfi-app_data`, `familyfi-postgres_data` (`familyfi-dev-postgres_data` for the dev database) | Volume names. |
| `POSTGRES_DATA_PATH` | `/var/lib/postgresql` | Where the PostgreSQL volume mounts. |

### Development and tests only

Never part of a deployment.

| Variable | Purpose |
| --- | --- |
| `KILL_PORT` | `1` stops whatever holds the dev port without asking; `0` never does. Unset, `make dev` asks. |
| `SKIP_DB_PREPARE` | Skips what `with-env.mjs` does before a command: wait for PostgreSQL, `prisma generate` outside production, and `prisma migrate deploy`. |
| `CLOUDFLARED_BIN` | Points integration tests at a stand-in `cloudflared`. |
| `CI` | Lets the production build start in `test` mode, as CI's browser tests run it. |
| `BASE_REF`, `BREAKING_API_APPROVED` | The OpenAPI checks' base branch and the `breaking_api` label. |

`FAMILYFI_DATABASE_SERVED` is set by the in-memory launcher for the command it runs, so a second database is not started; never set it yourself.

## Local development

1. Install Node.js 26+ and pnpm 10. `.node-version` names the version CI and the Docker image use; `nvm`, `fnm` and similar tools read it.
2. Install Docker if you want `make setup` to start PostgreSQL for you.
3. `cp .env.example .env` and set `POSTGRES_PASSWORD`. Recovery password and crypto secrets are written into `.env` on first setup if they are missing. The server log prints them as `username: admin` and `password:`.
4. `make setup` then `make dev`. `make dev` waits for PostgreSQL, applies pending Prisma migrations, regenerates the database client, then starts Next. The first start can take a few extra seconds. If port 3000 is already taken, `make dev` asks whether to kill that process.
5. Open http://localhost:3000. With `FAMILYFI_MODE=dev` the mock gateway is already saved, so sign in as `admin`; a household with no gateway key opens first-time setup instead, which hands over the admin password and signs you in.

`make setup` will not overwrite an existing `.env`.

### Modes

`FAMILYFI_MODE` names the kind of work a process does, and each mode fixes four things:

| Mode | Gateway | Database | Data | Configuration |
| --- | --- | --- | --- | --- |
| `prod` (default) | the household's UniFi gateway | PostgreSQL | the household's | open |
| `dev` | the UniFi mock | PostgreSQL, or in memory with `DB_MODE=memory` | the seed household | open |
| `test` | the UniFi mock | as `dev`; `scripts/test.py` gives each run its own | the seed household, or each test's | open |
| `demo` | the UniFi mock | in memory, always | the seed household, reset nightly | locked ([demo mode](operations.md#demo-mode)) |

Under `NODE_ENV=production` only `prod` and `demo` start, and `test` under CI (the browser tests run the production build); anything else stops startup with a message. Mocks do not prove firewall enforcement.

### Dummy household (no UniFi console)

Set `FAMILYFI_MODE=dev` in `.env` and restart `make dev`. The app fakes the Network Integration API with synthetic fixtures and encrypts the dummy key `mock-unifi-key` so Settings looks connected. It seeds a household with something in every state (`src/server/dev-household.ts`): Nick and Melinda (adults), Betsy and Abby (teens) and Cassie (a child, paused); TV, Computers, Games (with an allowance) and Servers; devices for each, some offline and three unassigned; rules of every kind, one of them paused; and category reports through Cloudflare for Families (`https://family.cloudflare-dns.com/dns-query`), with a seeded result for every category but Video. The probe stays off so those results are not replaced. Sign in as `admin` or `nick` (same `FAMILYFI_DEFAULT_PASSWORD`). The household, rules and devices are seeded only into a database with no people in it, and the mock connection and resolver only while no UniFi key is saved, so an existing development database keeps what it has; missing category results are added back on every start. Use this for UI work (adding a user, jittery buttons, layout). Set `FAMILYFI_MODE=prod` (or remove it) before pointing at a real gateway.

Add `DB_MODE=memory` to run without PostgreSQL or Docker: `make dev` starts an in-memory database with the server, applies the migrations and seeds it, and nothing is kept when the server stops.

If Docker is unavailable, run PostgreSQL yourself, point `DB_*` at it, then `make db-migrate`.

Phones on the LAN should use the host's LAN address, not `localhost`. HTTPS is required for a deployed PWA and for secure cookies in production.

## Authentication

- Username `admin` is reserved and cannot be removed through household administration.
- Adults granted admin access get personal usernames and passwords. Those names cannot be `admin`.
- Only administrators use FamilyFi: an adult without admin access is like a child or teen, with no sign-in, session or paired device. Every administrator is trusted with the whole household: accounts, household settings, the UniFi connection, paired devices and remote access. Turning an adult's admin off signs them out and removes their paired devices and pending invites. `tests/integration/authorization-matrix.test.ts` holds each route to this.
- Children, teens, and Things groups do not receive logins.
- Browser sessions use an httpOnly cookie plus a CSRF cookie. A phone joins by claiming an administrator-generated, five-minute invite code (scanned as a QR or pasted) at `POST /api/v1/paired/invites/{id}/claim`, which signs it in as the adult the administrator chose; later requests send `Authorization: Bearer`. Phones never sign in with a password, and a bare server address cannot enroll one.
- Five failed attempts in 15 minutes, per username or IP, are rejected with HTTP 429.
- Browser sessions last 30 days unless revoked (password change, access removal, or logout). A paired phone or Watch holds a one-hour bearer that it renews with a refresh token, which lasts 90 days from its last use and ends the same ways, or when the device is revoked.

Email magic links and self-serve email reset from the sign-in prototype are not implemented. Create personal adult accounts with `POST /api/v1/accounts` (adult Family group only). Recovery `admin` cannot be removed; change its password via `FAMILYFI_DEFAULT_PASSWORD` in `.env`.

## UniFi connection (application)

Paste the Network Integration API key in first-time setup, which opens after sign-in while no key is saved, or in Settings (`PUT /api/v1/settings/unifi`). The app encrypts it with `FAMILYFI_ENCRYPTION_KEY`. For a local console with a private CA, send `tlsInsecure: true`. Choose `manageAllNetworks: true` or `managedNetworkIds: ["…"]` so discovery/quarantine only watch those VLANs; the default is none until you pick.

With `FAMILYFI_MODE=dev` (never in production), Settings Test/Save talk to the in-process mock. A dummy key of at least 8 characters is enough; the seeded household already uses `mock-unifi-key` and `https://127.0.0.1/proxy/network/integration`.

## Remote access with a sidecar container

The easiest remote access is built in: **System → Pair Device → Remote access** (a quick tunnel, or
FamilyFi's Cloudflare tunnel on your own domain). Use a sidecar instead when you already run
Tailscale, or want a VPN or reverse proxy in front of FamilyFi. Set it up with the wiki guide, then
choose it under **My domain** and enter its HTTPS address:

- [Home network: VPN or reverse proxy](https://github.com/nickberardi/familyfi/wiki/Remote-access-home-network)
  — including an NGINX sidecar next to FamilyFi.
- [Tailscale](https://github.com/nickberardi/familyfi/wiki/Remote-access-Tailscale) — a Tailscale
  Serve sidecar; phones in your tailnet reach `https://familyfi.<your-tailnet>.ts.net`.

- [Your own Cloudflare Tunnel](https://github.com/nickberardi/familyfi/wiki/Remote-access-Cloudflare-Tunnel)
  — a `cloudflared` sidecar on your domain, optionally behind Cloudflare Access (below).

Anything reachable from the internet must point at FamilyFi's **phone-only gateway**
(`FAMILYFI_PHONE_GATEWAY_PORT`, for example `http://app:7002`), never the app itself on 7001, which
would put the web admin and its sign-in page on the internet. Never publish the gateway port on the
host.

### Cloudflare Tunnel you run

A tunnel you manage in the Cloudflare dashboard (Zero Trust → Networks → Tunnels → Create →
Cloudflared). In `.env`, set `FAMILYFI_PHONE_GATEWAY_PORT=7002` and `CLOUDFLARE_TUNNEL_TOKEN` to the
token the dashboard shows, and add the service:

```yaml
  cloudflared:
    image: cloudflare/cloudflared:2026.9.1
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN:?Set CLOUDFLARE_TUNNEL_TOKEN in .env}
    depends_on:
      - app
```

In the tunnel's **Public Hostname** settings, point your hostname (for example
`familyfi.example.com`) at service `http://app:7002`. Do **not** add 7002 to the app's `ports`.
Then on **Pair Device** choose **My domain → Cloudflare Tunnel → Advanced** and enter
`https://familyfi.example.com`. FamilyFi never sees the tunnel token: it lives only in your `.env`
and the sidecar. To put Cloudflare Access in front of it, see
[operations](operations.md#your-own-cloudflare-tunnel-and-cloudflare-access-advanced).

Pin image tags (a `cloudflared` release) rather than `latest`, so an upgrade happens when you
choose it.

