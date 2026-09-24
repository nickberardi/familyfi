# Operations

## Recovery admin

Username `admin` with `FAMILYFI_DEFAULT_PASSWORD` remains available after personal adult accounts exist. If `.env` has no usable recovery password, FamilyFi generates one and stores it as `FAMILYFI_DEFAULT_PASSWORD`. The running server prints that username and password in a boxed log line at startup (`make dev` or `make docker-logs`). Changing `FAMILYFI_DEFAULT_PASSWORD` in `.env` takes effect on the next `admin` sign-in. Do not put this password in the API or in issues.

## Backup and restore

Back up PostgreSQL and `FAMILYFI_ENCRYPTION_KEY` together (it lives in `.env` after first setup). Restoring the database without that key cannot decrypt the stored UniFi credential or the persisted companion instance signing key. Ordinary `make docker-down` does not delete volumes. Do not regenerate `FAMILYFI_ENCRYPTION_KEY` once a UniFi key has been saved.

## Companion access routes

Manage routes and pair phones from **System → Phones**. Pick a route, name the phone, and show
the QR; the page also shows the exact server address to type in the app and a `pairingId.token`
code for pairing without the camera. The code expires in five minutes and is cancelled when you
close it. Revoke a lost phone from the same page; it is signed out at once and must pair again. A revoked
phone stays listed until you **Remove** it, or use **Remove all revoked**; **Re-pair** opens a new
code with its name filled in, and once the phone uses it the old entry disappears.
Routes are tried top first, and a phone learns routes added after it paired from the signed
manifest, so adding a VPN or Tailscale route later reaches every paired phone.

HTTPS is required for every companion route. For a self-signed LAN certificate, choose **Pin this certificate** on the route and
**Read certificate from this address**: FamilyFi completes a TLS handshake with that address and
stores the SHA-256 of its public key, or hashes a certificate you paste when FamilyFi cannot reach
it. The value equals

```sh
openssl x509 -in cert.pem -pubkey -noout | openssl pkey -pubin -outform der \
  | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '='
```

**Check** on a pinned route compares the stored pin with what the address serves now. Renewing the
certificate with a new key breaks the pin until you update it; phones fail closed rather than
trust the new key. A certificate the iPhone already trusts should use ordinary trust instead.
 Start with direct LAN HTTPS and either a normal
system-trusted certificate or a pairing QR that pins the LAN server public key. A household
that already has VPN-to-LAN or a reverse proxy simply adds its HTTPS origin as a system-trusted
endpoint; FamilyFi does not manage the VPN, proxy, or certificate issuer.

For private remote access, add an operator-managed [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)
`https://…ts.net` origin as a `tailscale`/`system` endpoint. The phone must be in the same
tailnet. Do not use Tailscale Funnel: it would expose the household service publicly.

### Remote access (easy button)

**System → Phones → Remote access** turns on a Cloudflare quick tunnel with one switch: no
Cloudflare account, router change, DNS or certificate. FamilyFi runs the pinned `cloudflared`
shipped in the image (never a runtime download) and keeps one `cloudflare` route pointed at the
tunnel's address, so paired phones pick it up from the signed manifest.

The tunnel reaches only a phone-only gateway on loopback. It forwards `/api/v1/*` and nothing
else, drops cookies, and marks each call as remote. The web app and its sign-in page are not
reachable through it. Signing in remotely requires the FamilyFi app on a paired phone; its
device credential is checked before the password, so the internet cannot test passwords.

A quick tunnel's address changes whenever FamilyFi restarts. Phones learn the new one the next
time they reach FamilyFi another way, usually at home. Cloudflare offers quick tunnels for
testing, with no uptime guarantee and a 200-request concurrency limit. For a permanent address,
use your own domain or one of the options below.

### Remote access on your own domain

Choose **My domain**, enter a hostname on a domain in your Cloudflare account (for example
`familyfi.example.com`), and **Connect with Cloudflare**. FamilyFi shows a Cloudflare link; open
it, pick the domain, and come back — the page updates by itself. FamilyFi then:

1. creates a tunnel named `familyfi-<instance id>` and a DNS record for the hostname. It never
   overwrites a record that already exists; choose another hostname or remove that record first;
2. stores only that tunnel's credential, encrypted with `FAMILYFI_ENCRYPTION_KEY` like the UniFi
   key, and passes it to `cloudflared` through its environment, never a file;
3. deletes the account-wide certificate the Cloudflare sign-in produced, which could otherwise
   create and delete tunnels and DNS across the zone.

The address is permanent, so phones keep working across restarts. The tunnel still reaches only
the phone-only gateway. **Forget domain** deletes the stored credential; the tunnel and DNS
record stay in your Cloudflare account until you remove them there. Back up
`FAMILYFI_ENCRYPTION_KEY` with the database, as for the UniFi key.

### Cloudflare Access (advanced)

Cloudflare Tunnel with Access in front works as an ordinary `cloudflare`/`system` route when
Access is satisfied by the Cloudflare One Client (WARP) on the phone. Do not place a Cloudflare
service-token secret in a phone.

## Database modes

`make docker-up` and `make docker-dev-up` use `docker/docker-compose.yml`, which starts the app and PostgreSQL together. The database uses a named volume and is not published on the host. The app container is pointed at the `db` service.

- `DB_MODE=bundled` (default): the app expects Compose-managed PostgreSQL (`DB_HOST=db` in that stack).
- `DB_MODE=external`: the app uses `DB_HOST` and related settings for a server you already run (CI, container smoke, or `make setup` / `make db-dev`).

Users should not edit Compose YAML to pick a server.

## Outages

While FamilyFi is stopped or cannot reach UniFi, the gateway keeps the last applied policies **including UniFi policy schedules**. Recurring bedtime can still start and end. A timed Pause/Extend can outlast its expiry until FamilyFi PUTs `enabled: true`. New devices on **managed** VLANs can have internet until the next successful quarantine reconciliation. Unmanaged VLANs are never ingested. Startup reconciliation applies current desired state; it does not replay missed transitions.

## Upgrades

Release images run `prisma migrate deploy` on start. Local `make dev` does the same (`migrate deploy` plus `prisma generate`) before Next listens, so a new column cannot 500 login or Settings until the process is restarted. They do not run `prisma migrate dev`.

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
