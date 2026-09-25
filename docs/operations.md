# Operations

## Recovery admin

Username `admin` with `FAMILYFI_DEFAULT_PASSWORD` remains available after personal adult accounts exist. If `.env` has no usable recovery password, FamilyFi generates one and stores it as `FAMILYFI_DEFAULT_PASSWORD`. The running server prints that username and password in a boxed log line at startup (`make dev` or `make docker-logs`). Changing `FAMILYFI_DEFAULT_PASSWORD` in `.env` takes effect on the next `admin` sign-in. Do not put this password in the API or in issues.

## Backup and restore

Back up PostgreSQL and `FAMILYFI_ENCRYPTION_KEY` together (it lives in `.env` after first setup). Restoring the database without that key cannot decrypt the stored UniFi credential or the persisted companion instance signing key. Ordinary `make docker-down` does not delete volumes. Do not regenerate `FAMILYFI_ENCRYPTION_KEY` once a UniFi key has been saved.

## Remote access and pairing

**System → Pair Device** is where phones are paired and where you choose how the FamilyFi app
reaches home. **Remote access** publishes exactly one route at a time, and turns every other
route off:

| Choice | Who runs it | The route phones get |
| --- | --- | --- |
| **Off** | — | none: phones can't reach home, and none can pair |
| **Quick tunnel** | FamilyFi (`cloudflared`) | a `…trycloudflare.com` address that changes on restart |
| **My domain → Home network** | you (LAN, VPN or reverse proxy) | your HTTPS address, trusted or pinned |
| **My domain → Tailscale** | you (a Tailscale Serve sidecar) | `https://…ts.net`, trusted |
| **My domain → Cloudflare Tunnel → Automatic** | FamilyFi (`cloudflared`) | `https://<your hostname>` on your Cloudflare domain |
| **My domain → Cloudflare Tunnel → Advanced** | you (a `cloudflared` sidecar) | `https://<your hostname>`, trusted, optionally behind Cloudflare Access |

Switching is one step and can be done any time. Routes you have saved stay saved, so switching back
to one of them needs no retyping, and switching back to Automatic needs no new Cloudflare sign-in.
Setup guides: [home network (VPN or reverse proxy)](https://github.com/nickberardi/familyfi/wiki/Remote-access-home-network),
[Tailscale](https://github.com/nickberardi/familyfi/wiki/Remote-access-Tailscale) and
[your own Cloudflare Tunnel](https://github.com/nickberardi/familyfi/wiki/Remote-access-Cloudflare-Tunnel).

**Pair a phone** uses the published route: name the phone and show the QR; the sheet also shows the
exact server address to type in the app and a `pairingId.token` code for pairing without the
camera. The code expires in five minutes and is cancelled when you close it. Revoke a lost phone from
the same page; it is signed out at once and must pair again. A revoked phone stays listed until you
**Remove** it, or use **Remove all revoked**; **Re-pair** opens a new code with its name filled in,
and once the phone uses it the old entry disappears. A paired phone learns a newly published route
from the signed manifest the next time it reaches FamilyFi.

HTTPS is required for every route. For a self-signed home-network certificate, choose **Pin this
certificate** and **Read certificate from this address**: FamilyFi completes a TLS handshake with
that address and stores the SHA-256 of its public key, or hashes a certificate you paste when
FamilyFi cannot reach it. The value equals

```sh
openssl x509 -in cert.pem -pubkey -noout | openssl pkey -pubin -outform der \
  | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '='
```

**Check** on a pinned route compares the stored pin with what the address serves now. Renewing the
certificate with a new key breaks the pin until you update it; phones fail closed rather than
trust the new key. A certificate the iPhone already trusts should use ordinary trust instead.
FamilyFi does not manage your VPN, proxy, or certificate issuer. For Tailscale, the phone must be in
the same tailnet; use Serve, never Funnel, which would expose the household service publicly.

### Quick tunnel

**Quick tunnel** needs no Cloudflare account, router change, DNS or certificate. FamilyFi runs the
pinned `cloudflared` shipped in the image (never a runtime download) and keeps one `quick` route
pointed at the tunnel's address, so paired phones pick it up from the signed manifest.

The tunnel reaches only a phone-only gateway on loopback. It forwards `/api/v1/*` and nothing
else, drops cookies, and marks each call as remote. The web app and its sign-in page are not
reachable through it. Signing in remotely requires the FamilyFi app on a paired phone; its
device credential is checked before the password, so the internet cannot test passwords.

A quick tunnel's address changes whenever FamilyFi restarts. Phones learn the new one the next
time they reach FamilyFi another way. Cloudflare offers quick tunnels for testing, with no uptime
guarantee and a 200-request concurrency limit. For a permanent address, use **My domain**.

### Cloudflare Tunnel on your own domain (Automatic)

Choose **My domain → Cloudflare Tunnel → Automatic**, enter a hostname on a domain in your
Cloudflare account (for example `familyfi.example.com`), and **Connect with Cloudflare**. FamilyFi
shows a Cloudflare link; open it, pick the domain, and come back — the page updates by itself.
FamilyFi then:

1. creates a tunnel named `familyfi-<instance id>` and a DNS record for the hostname. It never
   overwrites a record that already exists; choose another hostname or remove that record first;
2. stores only that tunnel's credential, on the `domain` route and encrypted with
   `FAMILYFI_ENCRYPTION_KEY` like the UniFi key, and passes it to `cloudflared` through its
   environment, never a file;
3. deletes the account-wide certificate the Cloudflare sign-in produced, which could otherwise
   create and delete tunnels and DNS across the zone.

The address is permanent, so phones keep working across restarts. The tunnel still reaches only
the phone-only gateway. **Forget domain** deletes the domain route and its credential and turns
remote access off; the tunnel and DNS record stay in your Cloudflare account until you remove them
there. Back up `FAMILYFI_ENCRYPTION_KEY` with the database, as for the UniFi key.

### Your own Cloudflare Tunnel, and Cloudflare Access (Advanced)

**Advanced** is a tunnel you run in your own Cloudflare account, with the `cloudflared` sidecar in
[setup](setup.md#cloudflare-tunnel-you-run). FamilyFi doesn't manage it: it only needs the address.

1. Create the tunnel, and point its public hostname at the phone-only gateway, `http://app:7002`
   (with `FAMILYFI_PHONE_GATEWAY_PORT=7002`) — never at the app on 7001.
2. On **Pair Device**, choose **My domain → Cloudflare Tunnel → Advanced**, enter
   `https://<your hostname>`, and **Use this address**. Phones use it like any other trusted route.

**Cloudflare Access** adds a second barrier: Cloudflare turns away any request that doesn't carry
the route's service token, before it reaches FamilyFi. A request that gets past it still needs a
paired phone and a signed-in account, as without Access.

1. In Cloudflare Zero Trust, create a **service token**, then a **self-hosted application** for
   your hostname with one **Service Auth** policy that includes that token. Turn on **Return 401
   response for Service Auth policies**, so the app sees a plain refusal rather than a login page.
   Add no identity policies to this application.
2. On **Pair Device**, edit the Advanced route, tick **Protect with Cloudflare Access**, and paste
   the token's Client ID and Client Secret. FamilyFi stores them encrypted with
   `FAMILYFI_ENCRYPTION_KEY`.
3. Pair phones as usual. The pairing QR carries the token, so a phone can reach the protected
   address to pair; a phone already paired picks it up from its next signed manifest. Pair Device
   shows how many active phones have it. Turn the Access policy on once they all do.

The token only gets a request past Cloudflare, so it is treated as a shared key rather than a
password: it is in the QR and on paired phones, and never in `/api/v1/connection/identity`, a
browser's responses, or FamilyFi's logs. Anyone who sees a phone's HTTPS traffic, or a photo of a
pairing QR, can read it; replacing it is the remedy.

**Replacing the token** (a leak, or its expiry) never needs a phone outage:

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

`make docker-up` and `make docker-dev-up` use `docker/docker-compose.yml`, which starts the app and PostgreSQL together. The database uses a named volume and is not published on the host. The app container is pointed at the `db` service.

- `DB_MODE=bundled` (default): the app expects Compose-managed PostgreSQL (`DB_HOST=db` in that stack).
- `DB_MODE=external`: the app uses `DB_HOST` and related settings for a server you already run (CI, container smoke, or `make setup` / `make db-dev`).

Users should not edit Compose YAML to pick a server.

## Outages

While FamilyFi is stopped or cannot reach UniFi, the gateway keeps the last applied policies **including UniFi policy schedules**. Recurring bedtime can still start and end. A timed Pause/Extend can outlast its expiry until FamilyFi PUTs `enabled: true`. New devices on **managed** VLANs can have internet until the next successful quarantine reconciliation. Unmanaged VLANs are never ingested. Startup reconciliation applies current desired state; it does not replay missed transitions.

## Upgrades

Release images run `prisma migrate deploy` on start. Local `make dev` does the same (`migrate deploy` plus `prisma generate`) before Next listens, so a new column cannot 500 login or Settings until the process is restarted. They do not run `prisma migrate dev`.

A household may skip releases: any release from v0.1.0 on upgrades straight to the newest. CI proves it on every push by filling a database built by each release since v0.1.0 and upgrading it (`pnpm db-upgrade`). The floor is `OLDEST_SUPPORTED_RELEASE` in `scripts/check-migration-upgrade.mjs`; raising it needs a release note telling older households which release to step through first.

Published GHCR tags are `linux/amd64` and `linux/arm64` (`v*` git tags via Actions). Until a tag exists, use `make docker-dev-up`. Compose interpolates `POSTGRES_*` for the database service and passes `FAMILYFI_DEFAULT_PASSWORD`, `FAMILYFI_SESSION_SECRET`, `FAMILYFI_ENCRYPTION_KEY`, and mapped `DB_*` into the app container. The image does not read a mounted `.env` file.

## Releases

`package.json` is `0.3.0`. Publish that version with an annotated git tag that matches semver, then push the tag. Do not use `v0.3`; the release workflow’s Docker tags need a full `MAJOR.MINOR.PATCH`.

```bash
git checkout main
git pull
git tag -a v0.3.0 -m "FamilyFi 0.3.0"
git push origin v0.3.0
```

Pushing `v*` runs [`.github/workflows/release.yml`](../.github/workflows/release.yml): a multi-arch image (`linux/amd64` and `linux/arm64`) to `ghcr.io/nberardi/familyfi` (`0.3.0`, `0.3`, and `latest`) and a GitHub Release with generated notes. After the first package appears, link it to the repository in GitHub Packages if GHCR is not yet public.

Bump `package.json` and `openapi/familyfi.v1.yaml` `info.version` together before a later tag, so Settings, the sign-in screen, and `GET /api/v1/health` show the same number as the image tag. `tests/unit/version.test.ts` fails the build when the two drift apart.

Each release's notes cite the latest verification record for every scenario in [testing.md](testing.md#what-no-test-proves), linking the file under `docs/verification/`, or say "not run" for a scenario that has none. Run `pnpm spike verify` on a console first when the release changes how FamilyFi writes policies.

Every release so far is a **pre-release** on GitHub. The workflow does not set that flag, so mark the release as a pre-release after it is created, until the project reaches 1.0.

### Update availability

FamilyFi checks the published GitHub Releases for `nickberardi/familyfi` directly; GHCR tags and other registries are never used to decide whether an update exists. The running process checks immediately at startup and then once an hour, retaining the result only in its own memory. A restart therefore begins with an explicit `pending` status until its first check completes. While Settings is open, the browser reads the cached health snapshot every five seconds while pending and every minute afterward; those reads do not trigger GitHub requests.

Draft releases and malformed tags are ignored. While the running version is below `1.0.0`, published prereleases are eligible because FamilyFi's current release stream uses them. At `1.0.0` and later, only stable releases are offered. The highest applicable semantic version is shown in Settings → About and exposed through `GET /api/v1/health`.

Allow outbound HTTPS from the app container to `api.github.com`. A GitHub timeout, rate limit, or other failure does not degrade FamilyFi readiness or enforcement, but health reports `update.status: error` and `update.available: null`; it is never presented as up to date. The release check sends no credentials and has a 10-second timeout.
