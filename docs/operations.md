# Operations

## Recovery admin

Username `admin` with `FAMILYFI_DEFAULT_PASSWORD` remains available after personal adult accounts exist. If `.env` has no usable recovery password, FamilyFi generates one and stores it as `FAMILYFI_DEFAULT_PASSWORD`. The running server prints that username and password in a boxed log line at startup (`make dev` or `make docker-logs`). Changing `FAMILYFI_DEFAULT_PASSWORD` in `.env` takes effect on the next `admin` sign-in. Do not put this password in the API or in issues.

## Backup and restore

Back up PostgreSQL and `FAMILYFI_ENCRYPTION_KEY` together (it lives in `.env` after first setup). Restoring the database without that key cannot decrypt the stored UniFi credential or the persisted companion instance signing key. Ordinary `make docker-down` does not delete volumes. Do not regenerate `FAMILYFI_ENCRYPTION_KEY` once a UniFi key has been saved.

## Companion access routes

Manage routes and pair phones from **System → Phones**. Pick a route, name the phone, and show
the QR; the page also shows the exact server address to type in the app and a `pairingId.token`
code for pairing without the camera. The code expires in five minutes and is cancelled when you
close it. Revoke a lost phone from the same page; it is signed out at once and must pair again.
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

Cloudflare Tunnel and Access remain a future option. Cloudflare is only an outer perimeter;
the FamilyFi bearer session remains authoritative. Do not place a Cloudflare service-token
secret in a phone. Native Access browser/PKCE handoff must be designed and tested before that
route is enabled.

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

Every release so far is a **pre-release** on GitHub. The workflow does not set that flag, so mark the release as a pre-release after it is created, until the project reaches 1.0.

### Update availability

FamilyFi checks the published GitHub Releases for `nickberardi/familyfi` directly; GHCR tags and other registries are never used to decide whether an update exists. The running process checks immediately at startup and then once an hour, retaining the result only in its own memory. A restart therefore begins with an explicit `pending` status until its first check completes. While Settings is open, the browser reads the cached health snapshot every five seconds while pending and every minute afterward; those reads do not trigger GitHub requests.

Draft releases and malformed tags are ignored. While the running version is below `1.0.0`, published prereleases are eligible because FamilyFi's current release stream uses them. At `1.0.0` and later, only stable releases are offered. The highest applicable semantic version is shown in Settings → About and exposed through `GET /api/v1/health`.

Allow outbound HTTPS from the app container to `api.github.com`. A GitHub timeout, rate limit, or other failure does not degrade FamilyFi readiness or enforcement, but health reports `update.status: error` and `update.available: null`; it is never presented as up to date. The release check sends no credentials and has a 10-second timeout.
