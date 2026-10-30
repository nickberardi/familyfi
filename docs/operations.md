# Operations

## Recovery admin

Username `admin` with `FAMILYFI_DEFAULT_PASSWORD` remains available after personal adult accounts exist. If `.env` has no usable recovery password, FamilyFi generates one and stores it as `FAMILYFI_DEFAULT_PASSWORD`. The running server prints that username and password in a boxed log line at startup (`make dev` or `make docker-logs`). Changing `FAMILYFI_DEFAULT_PASSWORD` in `.env` takes effect when FamilyFi restarts, and signs out every browser signed in with the old one. The recovery admin is for a browser at home: no phone, Watch or agent pairs as it, so pair them as a personal administrator. Do not put this password in the API or in issues.

## Backup and restore

Back up PostgreSQL and `FAMILYFI_ENCRYPTION_KEY` together (it lives in `.env` after first setup). Restoring the database without that key cannot decrypt the stored UniFi credential or the persisted companion instance signing key. Ordinary `make docker-down` does not delete volumes. Do not regenerate `FAMILYFI_ENCRYPTION_KEY` once a UniFi key has been saved.

**Export and import.** Settings → Backup downloads `familyfi-export-<date>.tar.gz` (`GET /api/v1/settings/export`), and imports one (`POST /api/v1/settings/import`), which first-time setup also offers as **Restore from an export**. The archive holds:

- `manifest.json`: the export format, the FamilyFi version and install that wrote it, and its gateway.
- `config.json`: groups, rules and their windows, device assignments, administrator accounts with their password hashes, DNS categories, the household's own routes and its settings. No UniFi key, tunnel credential or Access token, no sessions, pairings or paired devices, no history, and no record of the gateway's policies.
- `database.dump`: a `pg_dump --format=custom` of the whole database, when `pg_dump` could reach it (the release image carries the PostgreSQL 18 client). It holds the secrets encrypted with this install's `FAMILYFI_ENCRYPTION_KEY`, which is never exported.

Import reads `config.json`, says what it will do, then replaces the household with it in one transaction, keeping any key, tunnel credential or Access token already saved here; a route whose Access token is missing comes in switched off, and FamilyFi's own tunnel routes are left out, so turn remote access on again. Routes this install has that the export lacks are kept, so a restore never cuts off a phone paired through one. Phones, Watches and agents paired here stay paired unless their account is removed or demoted; on a new install they pair again. The importing administrator is never removed or demoted and keeps their password; another account whose password hash changes is signed out. Export and import are for a browser on Settings: a paired phone is refused (403 `browser_session_required`), so neither reaches the remote access tunnel. The gateway connection comes from the file unless this install already holds a key for another gateway (a different mode, address, console or site). Rules, windows and DNS-over-HTTPS endpoints go through the same checks the API makes, so an edited or damaged export is refused before anything changes. A household category whose slug is now a built-in category's comes in as `<slug>-custom`. An export leaves out `database.dump` when it would make the file larger than import accepts (50 MB), and says so in its manifest. An export from a newer FamilyFi is refused: update first.

The next sync rebuilds the gateway's policies. Those this install created are removed by their creation records, as always; a policy another install created stays (FamilyFi never deletes a policy it cannot prove it made), so moving to a new install on the same gateway leaves the old install's FamilyFi policies for the operator to delete in UniFi. The import preview says when that applies.

For an exact copy instead (sessions, pairings, history and all), restore `database.dump` with the same `FAMILYFI_ENCRYPTION_KEY`, with FamilyFi stopped. From the folder with `docker-compose.yml`:

```bash
docker compose stop app
docker compose run --rm --no-deps -T --entrypoint /app/scripts/runtime/restore-database.sh app - < database.dump
docker compose up -d app
```

[`restore-database.sh`](../scripts/runtime/restore-database.sh) replaces the database whole: it checks the file is a dump, refuses while anything else is connected, then empties the database and loads the dump in one transaction, so a dump that fails to load changes nothing. The next start migrates the restored database to the release that runs it, like any upgrade, so a dump from an older release restores into a newer one. Restore it into the release that wrote it or a newer one, never an older one. Don't restore with `pg_restore --clean` into the existing database: it leaves behind the tables newer migrations added, and the next start fails on them.

The backups the updater takes before each install (`/var/lib/familyfi/data/backups/familyfi-v<version>-<time>.dump`, on the app volume) restore the same way, by their path in place of `-`:

```bash
docker compose run --rm --no-deps -T --entrypoint /app/scripts/runtime/restore-database.sh app /var/lib/familyfi/data/backups/familyfi-v0.34.0-20261026T000000Z.dump
```

## Remote access and pairing

**System → Pair Device** has four sections. **Get the FamilyFi app** shows the App Store and
Google Play badges; each links to the store once `APP_STORES` in `src/lib/pair-device.ts` has its
link, and until then reads "Coming soon". Google Play's badge instead opens the closed beta's
steps (`PLAY_BETA`) in a modal, linking to the full instructions at getfamilyfi.com/android/. **Home access** is always on: it is the address
FamilyFi has inside the home, where AI agents pair and connect. It shows the address you saved,
else the address you opened FamilyFi at when that is a private IP or `.local` name, else a warning
asking you to set one (for example when FamilyFi is opened through an authenticating proxy such as
Cloudflare Access, which an agent can't sign in to). Agent codes are still issued with the warning.

**Remote access** is how the FamilyFi app on phones and Watches reaches home. It publishes exactly
one route at a time, and turns every other route off:

| Choice | Who runs it | The route phones get |
| --- | --- | --- |
| **Off** | — | none: phones can't reach home, and none can pair |
| **Quick tunnel** | FamilyFi (`cloudflared`) | a `…trycloudflare.com` address that changes on restart |
| **Tailscale** | you (a Tailscale Serve sidecar) | `https://…ts.net`, trusted |
| **Cloudflare → Automatic** | FamilyFi (`cloudflared`) | `https://<your hostname>` on your Cloudflare domain |
| **Cloudflare → Advanced** | you (a `cloudflared` sidecar) | `https://<your hostname>`, trusted, optionally behind Cloudflare Access |
| **My domain** | you (VPN or reverse proxy) | your HTTPS address, trusted or pinned |

Switching is one step and can be done any time. Routes you have saved stay saved, so switching back
to one of them needs no retyping, and switching back to Automatic needs no new Cloudflare sign-in.
Remove takes a saved route away; removing the published one turns remote access Off, and a route
with a pairing code still waiting can't be removed until the code is cancelled or expires.
Setup guides: [My domain (VPN or reverse proxy)](https://github.com/nickberardi/familyfi/wiki/Remote-access-home-network),
[Tailscale](https://github.com/nickberardi/familyfi/wiki/Remote-access-Tailscale) and
[your own Cloudflare Tunnel](https://github.com/nickberardi/familyfi/wiki/Remote-access-Cloudflare-Tunnel).

**Pair a phone** uses the published route: name the phone and show the QR. The sheet also shows the
same pairing code as text, to copy and paste in the app when the phone can't scan it — for instance
when the sheet is open on that phone. The code carries the server address, so nothing else is typed. The code expires in five minutes and is cancelled when you close it. Revoke a lost phone from
the same page; it is signed out at once and must pair again. A revoked phone stays listed until you
**Remove** it, or use **Remove all revoked**. **Re-pair**, on any phone active or revoked, opens a
new code with its name filled in. An active phone keeps working until the code is used; then its old
entry is signed out and disappears, and its Watch moves to the new pairing (if the new pairing signs
in as another adult, the Watch is signed out instead and set up again from the phone). To recover a phone that
can't reach FamilyFi, re-pair it rather than revoking it first. **Paired devices** lists phones, Watches and
agents together, most recently seen first: what each may do, the account it acts as, how it reaches
home, and when its sign-in expires. A phone keeps the name you gave it when pairing. A paired phone learns a newly published route
from the signed manifest the next time it reaches FamilyFi.

HTTPS is required for every route. For a self-signed My domain certificate, choose **Pin this
certificate** and **Read certificate from this address**: FamilyFi completes a TLS handshake with
that address and stores the SHA-256 of its public key, or hashes a certificate you paste when
FamilyFi cannot reach it. The value equals

```sh
openssl x509 -in cert.pem -pubkey -noout | openssl pkey -pubin -outform der \
  | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '='
```

**Check** on a pinned route compares the stored pin with what the address serves now. Renewing the
certificate with a new key breaks the pin until you update it; phones fail closed rather than
trust the new key. A certificate phones already trust should use ordinary trust instead.
FamilyFi does not manage your VPN, proxy, or certificate issuer. For Tailscale, the phone must be in
the same tailnet; use Serve, never Funnel, which would expose the household service publicly.

### Quick tunnel

**Quick tunnel** needs no Cloudflare account, router change, DNS or certificate. FamilyFi runs the
pinned `cloudflared` shipped in the image (never a runtime download) and keeps one `quick` route
pointed at the tunnel's address, which paired phones receive in the signed manifest.

The tunnel reaches only a phone-only gateway on loopback. It forwards `/api/v1/*` and nothing
else, drops cookies, and marks each call as remote. The web app and its sign-in page are not
reachable through it. Signing in remotely requires the FamilyFi app on a paired phone; its
device credential is checked before the password, so the internet cannot test passwords.

A quick tunnel's address changes whenever FamilyFi restarts. Phones paired through it can't reach
the new address and must be re-paired from Pair Device; the app's offline screen says so. Cloudflare
offers quick tunnels for testing, with no uptime guarantee and a 200-request concurrency limit. For
a permanent address, use **Cloudflare → Automatic** or **Tailscale**, or **My domain** for a VPN or
reverse proxy you already run.

### Cloudflare Tunnel on your own domain (Automatic)

Choose **Cloudflare → Automatic**, enter a hostname on a domain in your
Cloudflare account (for example `familyfi.example.com`), and **Connect with Cloudflare**. FamilyFi
shows a Cloudflare link; open it, pick the domain, and come back — the page updates by itself.
FamilyFi then:

1. creates a tunnel named `familyfi-<instance id>-<random>` and a DNS record for the hostname. It
   never overwrites a record that already exists; choose another hostname or remove that record
   first. The one exception is a record FamilyFi itself made for a domain you forgot: connecting
   that hostname again replaces it;
2. stores only that tunnel's credential, on the `domain` route and encrypted with
   `FAMILYFI_ENCRYPTION_KEY` like the UniFi key, and passes it to `cloudflared` through its
   environment, never a file;
3. deletes the account-wide certificate the Cloudflare sign-in produced, which could otherwise
   create and delete tunnels and DNS across the zone.

The address is permanent, so phones keep working across restarts. The tunnel still reaches only
the phone-only gateway.

**Changing the hostname** signs in to Cloudflare again and saves the new domain before removing
anything, so a change that fails (a hostname that is taken, say) brings the old one back. Once
the new hostname is set up, FamilyFi deletes its old tunnel and the old hostname's DNS record,
while it still holds the sign-in certificate: the record only if it still points at that tunnel, so
a record FamilyFi did not create is never touched. If Cloudflare refuses (for example, the old
hostname is in a zone the sign-in did not cover), the new hostname still goes live and the page says
which record or tunnel to delete in Cloudflare yourself.

**Forget domain** deletes the domain route and its credential and turns remote access off at once,
then shows one more Cloudflare link: sign in, and FamilyFi deletes its tunnel and the hostname's
DNS record (again only a record pointing at that tunnel). **Keep them** leaves both in your
Cloudflare account; so does a sign-in that does not finish, and the page then says what to delete there.
The next time you connect a domain, FamilyFi finds what it left behind and removes it then.

Back up `FAMILYFI_ENCRYPTION_KEY` with the database, as for the UniFi key.

### Your own Cloudflare Tunnel, and Cloudflare Access (Advanced)

**Advanced** is a tunnel you run in your own Cloudflare account, with the `cloudflared` sidecar in
[setup](setup.md#cloudflare-tunnel-you-run). FamilyFi doesn't manage it: it only needs the address.

1. Create the tunnel, and add a published application route whose Service URL is the remote
   access port, `http://app:7002`
   (`FAMILYFI_REMOTE_ACCESS_PORT`) — never at the app on 7001.
2. On **Pair Device**, choose **Cloudflare → Advanced**, enter
   `https://<your hostname>`, and **Use this address**. Phones use it like any other trusted route.

**Cloudflare Access** adds a second barrier: Cloudflare turns away any request that doesn't carry
the route's service token, before it reaches FamilyFi. A request that gets past it still needs a
paired phone and a signed-in account, as without Access.

Creating the Access application is what turns Access on, so it comes last, once phones hold the
token:

1. In Cloudflare Zero Trust, create a **service token**.
2. On **Pair Device**, edit the Advanced route, tick **Protect with Cloudflare Access**, and paste
   the token's Client ID and Client Secret. FamilyFi stores them encrypted with
   `FAMILYFI_ENCRYPTION_KEY`. The pairing code carries the token, and a phone already paired picks
   it up from its next signed manifest.
3. Wait until Pair Device shows "Every active phone has the token." (or "No active phones yet.").
4. Only then create a **self-hosted application** for your hostname with one **Service Auth**
   policy that includes that token. Turn on **401 Response for Service Auth policies**, so the app
   sees a plain refusal rather than a login page. Add no identity policies to this application.

The token only gets a request past Cloudflare, so it is treated as a shared key rather than a
password: it is in the pairing code and on paired phones, and never in `/api/v1/connection/identity`, a
browser's responses, or FamilyFi's logs. Anyone who sees a phone's HTTPS traffic, or a photo of a
pairing code, can read it; replacing it is the remedy.

When the token nears its expiry, **Refresh** it (or edit its duration) in Cloudflare's Service
Tokens. That keeps the same Client ID and Secret, so nothing changes in FamilyFi.

**Replacing the token** (after a leak) never needs a phone outage:

1. In Cloudflare, **rotate** the token's secret and pick a grace period (up to 30 days) during which
   the old secret still works — or create a second token and add it to the same policy.
2. Paste the new Client ID and Secret into the Advanced route. Phones pick it up the next time they
   reach FamilyFi.
3. Wait until Pair Device says every active phone has the new token, then remove the old token in
   Cloudflare (or let its grace period end).

A phone that stays away from FamilyFi for the whole overlap still holds the old token, so Cloudflare
turns it away. Pair it again from Pair Device — one QR scan; its household account is unchanged.

To turn Access off, use **Turn off Access** on Pair Device first, then remove the Access
application in Cloudflare. Doing it the other way round turns every phone away until they reach
FamilyFi another way.

## Database modes

`make docker-up` and `make docker-dev-up` use `docker/docker-compose.yml`, which starts the app and PostgreSQL together. The database uses a named volume and is published on the host's loopback address only (`127.0.0.1`, port `POSTGRES_PORT`), for tools on that machine; the rest of the network cannot reach it. The app container is pointed at the `db` service.

- `DB_MODE=bundled` (default): the app expects Compose-managed PostgreSQL (`DB_HOST=db` in that stack).
- `DB_MODE=external`: the app uses `DB_HOST` and related settings for a server you already run (CI, container smoke, or `make setup` / `make db-dev`).
- `DB_MODE=memory`: an in-memory database that starts and ends with the server, for `FAMILYFI_MODE=dev` and `test` ([modes](setup.md#modes)). Demo mode always uses it; `prod` refuses it.

Users should not edit Compose YAML to pick a server.

## Demo mode

`FAMILYFI_MODE=demo` runs the demo image as a public demo, such as the one App Review and the getfamilyfi.com site point at. Nothing in it is real or kept:

- **Database.** The entrypoint hands over to `scripts/runtime/memory-database.mjs`, which serves an in-memory [PGlite](https://pglite.dev) database on loopback (port 5433, or `POSTGRES_PORT`; through its own small wire-protocol server, `pglite-server.mjs`), applies the migrations and runs FamilyFi against it. The other `DB_*` and `POSTGRES_*` settings are ignored and need not be set. No volume is needed; every start begins empty.
- **Household.** The UniFi mock stands in for the gateway, and the boot seed adds the dummy household, as `FAMILYFI_MODE=dev` does in development. Visitors use groups, rules, pauses, devices and pairing as at home.
- **Locked configuration.** Every visitor shares one household, so configuration writes answer 403 `demo_locked` ([API](api.md#shared-behaviour-and-consumer-adoption)): household and UniFi settings, accounts and passwords, resolvers, connection routes, their certificate pins and checks, and remote access. The demo never opens a Cloudflare tunnel from its host.
- **Sign-in.** `admin` (the recovery admin) and `nick` (Nick's administrator account), both with `FAMILYFI_DEFAULT_PASSWORD`. The sign-in page shows the `admin` login to every visitor and fills it in, so anyone can try the demo; accounts and passwords are locked, so the password guards nothing but the simulated household. Sign-in throttling there counts failures per address only, so one visitor cannot lock the shared login. Set `FAMILYFI_TRUSTED_PROXIES` to the ingress's addresses (the private ranges, behind a platform ingress such as Azure Container Apps) so each visitor counts as their own address; unset, every visitor counts as the ingress and one visitor's failures lock everyone out for 15 minutes. Set it on the host so it survives restarts, and never reuse a password from anywhere else. The session secret and encryption key may be left to generate on each start.
- **Phones.** Set `FAMILYFI_DEMO_URL` to the demo's public HTTPS origin (for example `https://demo.getfamilyfi.com`). It is published as the household's remote route: the hosted website itself is the connection, like a household's reverse proxy (a `lan` route with the phone's system certificate check, no tunnel and no Cloudflare Access), so Pair Device issues pairing codes for it as it would at home. Android 17 asks for Nearby devices access when a household has such a route; pairing over the public address works either way. The ingress terminates TLS and must pass `X-Forwarded-Proto` and `X-Forwarded-Host`, which sign-in's origin and secure-cookie checks read.
- **Reset.** The process exits at 03:00 in the household's time zone each night; it exits with status 1, so any restart policy (`--restart on-failure`, `unless-stopped`, or the platform's own) brings it back with a fresh household. A web banner says the demo resets nightly.

The release image leaves out the UniFi mock's fixtures (`tests/fixtures/unifi`), which demo mode reads from disk. The hosted demo's image, `ghcr.io/nickberardi/getfamilyfi.com:demo`, is built in the [getfamilyfi.com](https://github.com/nickberardi/getfamilyfi.com) repository from each new release, which it checks for weekly: the release image plus that tag's fixtures. To try it locally:

```bash
docker run --rm -p 7001:7001 -e FAMILYFI_MODE=demo -e FAMILYFI_DEFAULT_PASSWORD=choose-a-password ghcr.io/nickberardi/getfamilyfi.com:demo
```

## Outages

While FamilyFi is stopped or cannot reach UniFi, the gateway keeps the last applied policies **including UniFi policy schedules**. Rule windows can still start and end. A timed pause can outlast its expiry until FamilyFi deletes its pause policy, and an allowance until FamilyFi puts the group's devices back in its internet rules. New devices on **managed** VLANs can have internet until the next successful quarantine reconciliation. Unmanaged VLANs are never ingested. Startup reconciliation applies current desired state; it does not replay missed transitions.

## Upgrades

Release images run `prisma migrate deploy` on start. Local `make dev` does the same (`migrate deploy` plus `prisma generate`) before Next listens, so a new column cannot 500 login or Settings until the process is restarted. They do not run `prisma migrate dev`.

The migration history starts from one baseline, `prisma/migrations/00000000000000_baseline`, which replaced the prereleases' 33 migrations ([#153](https://github.com/nickberardi/familyfi/issues/153)). Databases built by a prerelease (v0.1.0 to v0.17.0) are not upgraded: `migrate deploy` fails on them because their tables already exist. Such a household starts over with an empty database: stop FamilyFi, remove the PostgreSQL volume (`familyfi-postgres_data` by default; keep the app data volume and `.env`, which hold `FAMILYFI_ENCRYPTION_KEY`), start the new release and set FamilyFi up again. With `DB_MODE=external`, drop and recreate the database instead. A development database (`familyfi-dev-postgres_data`) starts over the same way: `make dev` fails at `migrate deploy` until it does.

From the first release on the baseline (v0.22.3), a household may skip releases: any of them upgrades straight to the newest. CI proves it on every push by filling a database built by each supported release and upgrading it, and by restoring a dump of it over a database already at the new release with `restore-database.sh` and upgrading that (`pnpm db-upgrade`); until that release is tagged there is nothing to upgrade from. The floor is `OLDEST_SUPPORTED_RELEASE` in `scripts/ci/check-migration-upgrade.mjs`; raising it needs a release note telling older households which release to step through first.

From v0.39.0, `FAMILYFI_UPDATE_TAG` picks the tag and `FAMILYFI_IMAGE` is no longer read. A household that set `FAMILYFI_IMAGE=ghcr.io/nickberardi/familyfi:<tag>` in `.env` replaces it with `FAMILYFI_UPDATE_TAG=<tag>` and takes the new `docker-compose.yml`; until it does, the update check offers `latest`'s releases, and with the new Compose file alone the old line is ignored and Compose runs `:latest`. One pinned by digest follows [when an update fails](#when-an-update-fails) instead.

Published GHCR tags are `linux/amd64` and `linux/arm64` (`v*` git tags via Actions). Use `make docker-dev-up` to build locally. Compose interpolates `POSTGRES_*` for the database service and passes `DB_*` and `POSTGRES_*` into the app container, which reaches PostgreSQL on port 5432 inside the Compose network. The app generates `FAMILYFI_DEFAULT_PASSWORD` and `FAMILYFI_ENCRYPTION_KEY` on first boot and keeps them in `/var/lib/familyfi/data/.env` on its volume; it does not read the host's `.env`.

### When an update fails

When a release's migrations fail, FamilyFi doesn't start, and every restart fails the same way. The gateway keeps the rules it already has meanwhile ([outages](#outages)). `docker compose logs app` shows Prisma's error and, below it, the failed migration and the steps back with the newest backup filled in ([`migration-failed.sh`](../scripts/runtime/migration-failed.sh)). From the folder with `docker-compose.yml`:

1. `docker compose stop app`
2. Restore the backup the updater took before installing this release, while this release's image is still the one Compose runs (older images have no restore script): `docker compose run --rm --no-deps -T --entrypoint /app/scripts/runtime/restore-database.sh app /var/lib/familyfi/data/backups/familyfi-v<version>-<time>.dump`. `docker compose run --rm --no-deps --entrypoint ls app /var/lib/familyfi/data/backups` lists them.
3. `docker pull ghcr.io/nickberardi/familyfi@sha256:<digest>`, with the image the notes of the release in the backup's name give, on `https://github.com/nickberardi/familyfi/releases/tag/v<version>`.
4. `docker tag ghcr.io/nickberardi/familyfi@sha256:<digest> ghcr.io/nickberardi/familyfi:rollback`
5. Set `FAMILYFI_UPDATE_TAG=rollback` in `.env`.
6. `docker compose up -d app`

GHCR has no `:rollback`, so Watchtower installs nothing while the household runs it (Maintenance reports **not installed**); from v0.39.0, Checkup also shows it as a problem. Set `FAMILYFI_UPDATE_TAG` back to `latest` or `next`, or remove the line, once a release fixes the failure. Report the failure with the log. Without a backup, restore your own copy of the database and run the release it came from. `prisma migrate resolve` is only for someone who has found and fixed the cause by hand; it marks the migration done or rolled back and changes nothing else.

## Releases

Publishing requires the operator's request. The release tag is `v` followed by the full `MAJOR.MINOR.PATCH` version, normally the one already in `package.json` and `openapi/familyfi.v1.yaml`. Never copy an old version from a documentation example.

Create a **Pre-release** on GitHub for the intended commit on `main`, with a new tag or one already pushed; pushing a `v*` tag on its own works too. The tag runs [`.github/workflows/release.yml`](../.github/workflows/release.yml), which requires CI and container smoke, builds `linux/amd64` and `linux/arm64` images at `ghcr.io/nickberardi/familyfi`, and moves `:next` to them, unless a newer tag exists already. It names the image by digest at the top of the release's notes, creating the release as a Pre-release with generated notes when there is none. If the notes already name an image GHCR has, the workflow assumes local publication and skips these jobs; that alone does not prove checks passed.

### Tracks

A household follows the tag `FAMILYFI_UPDATE_TAG` names in `.env` ([setup](setup.md#docker-compose)), for example `FAMILYFI_UPDATE_TAG=next`. Compose runs that tag, Watchtower pulls it, and the update check offers its releases:

| `FAMILYFI_UPDATE_TAG` | Gets | Update check offers |
| --- | --- | --- |
| `latest`, blank or missing (default) | releases you have promoted | releases not marked Pre-release |
| `next` | every release, as soon as it is built | every release |
| `X.Y`, such as `0.38` | promoted releases of that line, for pinning | that line's releases not marked Pre-release |

The update check offers the release the tag holds in GHCR now ([update availability](#update-availability)); the last column is what it offers when GHCR cannot say. It reads any other value as `latest`, and Checkup shows a problem naming it. Compose still runs the tag it names, so one GHCR doesn't have, such as a typo, stops `docker compose up` until it is fixed.

To promote a release, edit it on GitHub and change its label from Pre-release to None (or Latest, where GitHub offers it). [`.github/workflows/promote.yml`](../.github/workflows/promote.yml) runs on that change, takes the image its notes name and moves `:latest` and `:X.Y` to it; nothing is rebuilt, so `:latest` is exactly what ran on `:next`. It can be behind the newest Pre-release, never behind a release of its line already promoted: that run fails and nothing moves. A fix to an older line (v0.38.1 after v0.39.0 is promoted) moves that line's `:X.Y` alone, so households pinned to it get the fix and `:latest` stays. Don't delete a Pre-release to make a new release on its tag, since its notes hold the image. `workflow_dispatch` promotes a tag by hand with the workflow on `main`; the `released` trigger runs the workflow as it was at the release's tag, so only tags made after the workflow existed promote on their own. A release published as a full release straight away fires that trigger before its image is built; that run promotes nothing, and the Release workflow promotes it once it has built the image (tags made before this existed need promoting by hand). Running the Release workflow again for a full release rebuilds its image under a new digest, names it in the notes and promotes it, so `:latest` holds the image the notes name. Before the first promotion, `:latest` still runs the last build from before the two tracks, and households on it are offered Pre-releases they cannot install; promote the first release soon. No image is tagged with its version: each build is pushed by its digest, under no tag of its own, and a release's image is pinned by that digest in its notes.

Moving a household from `next` to `latest` while `latest` is behind runs an older release on a newer database, which it cannot use; wait until `latest` reaches the release the household runs.

Both release paths pass the tag's version into the image build (`APP_VERSION` in `docker/Dockerfile`), so Settings, the sign-in screen, `GET /api/v1/health` and the update check report the image's own tag even when `package.json` lags behind it. When a stable tag is newer than `main`'s `package.json`, `release.yml`'s `version-pr` job opens a PR that bumps `package.json` and `openapi/familyfi.v1.yaml` `info.version` to it; merge it after the release. A PR opened with the workflow's own token starts no checks, so the job uses the `RELEASE_PR_TOKEN` secret (contents and pull requests: write) when it exists; without it, the repository setting that allows GitHub Actions to create pull requests must be on, or the job fails after the release is published. Bumping both before tagging still works and opens no PR. `tests/unit/version.test.ts` fails the build when the two drift apart. `cloudflared.yml`, which opens a PR bumping the image's cloudflared on the 1st and 15th of each month, uses the same token and needs the same setting without it.

Release notes say whether anyone checked a block on a real gateway since the last release. Nothing in CI proves enforcement ([testing.md](testing.md#what-no-test-proves)), so a release that changes how FamilyFi writes policies says so plainly.

### Local release

`scripts/release.sh` publishes a release from your machine, without the runners: it checks that `HEAD` is on `origin/main`, runs the checks and tests of `ci.yml`'s verify job and `container.yml` through `scripts/test.py`, builds and pushes both architectures to GHCR with the same tags, and creates the GitHub Release as a Pre-release naming the image by digest. It never promotes.

```bash
scripts/release.sh --tag vX.Y.Z  # replace with the matching package/spec version
```

It logs in to GHCR with `GHCR_TOKEN` (from the environment or a gitignored `.release.env`), or with `gh auth token` once `gh auth refresh -s write:packages` has granted that scope. Creating the Release creates the tag, which starts `release.yml`; its `on-main` job finds the image the notes name already on GHCR and skips the rest. To rebuild and push the image of a release that already exists, check out its tag and add `--force`; the release's notes then name the new image. Options and details are in [`scripts/README.md`](../scripts/README.md#releasesh).

### Update availability

FamilyFi checks the published GitHub Releases for `nickberardi/familyfi` directly, and asks GHCR, anonymously as a pull would, which image the track's tag (`latest`, `next` or `X.Y`) holds now. The release whose notes name that digest is the one offered, since it is what **Install** gets: a release published on GitHub before its image is built, or one that stops being a Pre-release before promote.yml has moved `:latest` (or whose promotion failed), is not offered until the tag holds it. When GHCR cannot be asked, or holds an image no release names, the check falls back to the releases' labels below. The running process checks immediately at startup and then once an hour, retaining the result only in its own memory. A restart therefore begins with an explicit `pending` status until its first check completes. An administrator reading the update settings (Settings' Maintenance tab, or the app's) checks again when the last check is more than five minutes old and no install is under way, so a release published or promoted from Pre-release since then is offered right away. Its **Check now** asks again at once (`POST /api/v1/settings/update/check`), unless a check finished in the last fifteen seconds. While Settings is open, the browser reads the cached health snapshot every five seconds while pending and every minute afterward; those reads do not trigger GitHub requests.

Draft releases and malformed tags are ignored. Without GHCR's answer, which releases are offered depends on the household's [track](#tracks), read from `FAMILYFI_UPDATE_TAG`: on `next` every published release, on a line such as `0.38` that line's releases not marked Pre-release, and on anything else (or nothing) only releases not marked Pre-release. When it is newer than the running version, Checkup shows it as a problem (counted on Checkup's badge) whose Update button opens Settings' Maintenance tab, with the release's notes from GitHub, a link to the release and, with the updater set up, its Install button; the check is also exposed through `GET /api/v1/health`.

Allow outbound HTTPS from the app container to `api.github.com`, and to `ghcr.io` for the tag check. A GitHub timeout, rate limit, or other failure does not degrade FamilyFi readiness or enforcement, but health reports `update.status: error` and `update.available: null`; it is never presented as up to date. The release check sends no credentials and has a 10-second timeout.

### Automatic updates

With the Watchtower sidecar answering ([setup](setup.md#automatic-updates)), the Maintenance tab's **Install** asks it to replace FamilyFi with the release the check found (`POST /api/v1/settings/update/install`), and **Automatic updates** does the same on household-local days and a time, Sunday at midnight unless changed (`PUT /api/v1/settings/update/schedule`). The schedule is stored as cron on the household, `Household.updateSchedule` (`0 0 * * 0` by default), in the one form the page's day and time pickers produce: `minute hour * * days`. A scheduled install runs only when the check finds a newer release and Watchtower answers to the token; one missed by more than an hour, because FamilyFi was down, waits for the next scheduled time; when the release check itself fails it is tried again every 15 minutes within that hour; and each scheduled instant is claimed once (`Household.updateScheduleLastRunAt`), so the restart an install causes never installs again.

Each request is written on the household row before Watchtower is asked (`updateRequestedAt`, `updateTargetVersion`, `updateStatus`, `updateError`), because the process that asks is the one being replaced; only the latest install is kept, and Settings' Maintenance tab shows it in one line. The next process to read it settles it: the new release on its first start (`succeeded`), or the old one, from Watchtower's history, when Watchtower left it running. That is `failed` when Watchtower could not replace it, when the backup before installing failed, when Watchtower's scan failed or looked at no container, or when it reported nothing within 30 minutes; `skipped` when it skipped the app for a reason of its own; and `unchanged` when there was no newer image under the tag the app runs. Watchtower (1.23.1 and later) counts the backup hook's exit 75 as a skip, so the hook also writes why it failed to `backups/last-failure`, and FamilyFi reads a skip with a newer one as the backup failing. A run settled before the release arrived (a pull longer than 30 minutes) becomes `succeeded` once FamilyFi runs that release. Install while Watchtower is still busy with an earlier request's install (it answers 429) keeps the new request open for that install to settle. A scheduled install that Watchtower fails gives its slot back and is tried again every 15 minutes within the hour, and changing the household's time zone moves the schedule with it. The gateway keeps enforcing throughout ([outages](#outages)); startup applies migrations and reconciles, as for any upgrade.

