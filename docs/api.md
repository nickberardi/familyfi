# API

The web UI and any future native client use `/api/v1`. The source of truth is [`openapi/familyfi.v1.yaml`](../openapi/familyfi.v1.yaml). Mutations return a `change` object (`changeId` + `revision`); poll `GET /api/v1/changes/{id}` for that action. Global last-sync success is not proof that your change applied.

Browser mutations after login send `X-CSRF-Token` matching the `familyfi_csrf` cookie. Native clients send `Authorization: Bearer`.

Normal payloads never return password hashes, `FAMILYFI_DEFAULT_PASSWORD`, raw UniFi keys, or firewall JSON.

## Implemented

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/health` | No secrets; includes `version` from `package.json` and an additive cached GitHub update-check snapshot. `update.available` is `null`, never `false`, while checking or after a GitHub failure. |
| POST | `/api/v1/auth/login` | Cookie session, or a paired native device bearer session |
| POST | `/api/v1/auth/logout` | CSRF for cookies; bearer for native |
| GET | `/api/v1/auth/session` | Current principal |
| GET/POST | `/api/v1/accounts` | Personal adult accounts; recovery `admin` is listed and cannot be created here |
| GET/PUT/DELETE | `/api/v1/accounts/{id}` | Recovery admin cannot be edited or deleted |
| PUT | `/api/v1/accounts/{id}/password` | Revokes that account's sessions; recovery uses `.env` |
| GET/PUT | `/api/v1/settings/household` | IANA timezone; `quarantineEnforced` false is an emergency UniFi `enabled: false` on quarantine policies |
| GET | `/api/v1/connection/identity` | Public household identity for pairing; never returns a credential or UniFi state |
| GET | `/api/v1/connection` | Authenticated endpoint manifest, FamilyFi-to-UniFi status, and the account's last attributed change |
| GET/POST | `/api/v1/connection/endpoints` | Every saved route with its `kind` (`quick`, `domain`, `own`), and whether Cloudflare Access guards it (`edgeAuth`, `edgeTokenVersion`). POST adds a route the household runs; publish it through `/connection/tunnel` |
| PUT/DELETE | `/api/v1/connection/endpoints/{id}` | Update or remove a route the household runs. A write-only `serviceToken` puts an `own` `cloudflare` route behind Cloudflare Access (a different token replaces it); `edgeAuth: none` turns Access off; any other route is 409 `access_unsupported`. A duplicate address is 409 `endpoint_exists`; deleting a route while an unclaimed pairing uses it is 409 `endpoint_in_use`; a `quick` or `domain` route is 409 `managed_route`. Deleting the published route turns remote access off |
| GET/PUT | `/api/v1/connection/tunnel` | Remote access: publish one route — `off`, `quick`, or `named` with a `hostname` (FamilyFi's Cloudflare tunnel on your domain) or an `endpointId` (a route you run). Every other route is turned off |
| POST | `/api/v1/connection/pairings` | Administrator creates a single-use, five-minute pairing code |
| POST | `/api/v1/connection/pins` | Administrator computes a route's SPKI pin from its live address (TLS handshake only) or a pasted PEM; stores nothing |
| GET/DELETE | `/api/v1/connection/pairings/{id}` | Administrator reads a pairing's status (`pending`, `claimed`, `expired`) or cancels it early |
| POST | `/api/v1/connection/pairings/{id}/claim` | Phone consumes a pairing and receives its device credential and signed endpoint manifest |
| GET | `/api/v1/connection/devices` | Administrator list of paired phones and Watches, the route each phone paired through (`pairedVia`), the Cloudflare Access token version it last received per route (`edgeTokens`), and active sessions |
| POST | `/api/v1/connection/devices` | A signed-in paired iPhone automatically enrolls its reachable Watch (`client: "watch"`, `clientId`) as an independent device and receives its own credential and bearer for transfer |
| DELETE | `/api/v1/connection/devices/{id}` | Administrator or the device itself revokes that device and its sessions. Only an administrator may use `?remove=true` to delete its record |
| DELETE | `/api/v1/connection/devices?revoked=true` | Administrator removes every revoked phone's record; active phones are untouched |
| GET/PUT | `/api/v1/settings/unifi` | Masked key; PUT probes then encrypts. Network allowlist: `manageAllNetworks` or `managedNetworkIds` |
| POST | `/api/v1/settings/unifi/test` | Probe without saving; returns site networks (id, name, vlanId) |
| GET/POST | `/api/v1/groups` | Family/Things |
| GET/PUT/DELETE | `/api/v1/groups/{id}` | Delete quarantines member devices |
| PUT | `/api/v1/groups/{id}/schedule` | Recurring bedtime stored on UniFi `schedule` |
| POST | `/api/v1/groups/{id}/pause` | Empty body = indefinite; `{ "until" }` = timed. Sets UniFi `enabled: false` |
| POST | `/api/v1/groups/{id}/resume` | Clears suspension (`enabled: true`; schedule may still block) |
| POST | `/api/v1/groups/{id}/extend` | Adds minutes to a timed pause |
| GET | `/api/v1/devices` | `?assignment=assigned` or `quarantined` |
| GET/DELETE | `/api/v1/devices/{mac}` | GET includes `unresolved` when zone is unknown; DELETE removes the record and assignment, then sync rediscovers a still-present in-scope device as quarantined |
| PUT | `/api/v1/devices/{mac}/assignment` | `{ "groupId": "…" }` or `null` for quarantine |
| GET | `/api/v1/sync` | Revision, last run, app-owned policy counts, recent changes |
| POST | `/api/v1/sync/retry` | Enqueue another run |
| GET | `/api/v1/changes/{id}` | Per-action status |
| GET/POST | `/api/v1/upstream/categories` | Domain-list categories with their domains and last verdict, including each check's per-domain results. **No `change` object** — see below |
| GET/PATCH/DELETE | `/api/v1/upstream/categories/{id}` | `domains` is the whole *active* list and replaces what is stored. A built-in category cannot be renamed or deleted |
| POST | `/api/v1/upstream/categories/{id}/check` | Check one category now; 200 even when the resolver was unreachable |
| GET | `/api/v1/upstream/checks` | Latest verdict per category |
| POST | `/api/v1/upstream/checks/run` | Sweep every category with checking on |
| GET/PUT/DELETE | `/api/v1/upstream/resolver` | Household DoH endpoint, returned in full, plus the check schedule (`probeTime`, `probeDays`, `lastRunAt`, `nextRunAt`). Changing or removing the endpoint immediately clears household verdicts; changing the schedule re-arms it immediately |
| PUT/DELETE | `/api/v1/groups/{id}/resolver` | A group's own DoH endpoint. Changing or removing it immediately clears that group's verdicts |

The `upstream` resource is the one exception to the `change` envelope. Those rows are
reporting only and never produce a UniFi policy, so there is nothing to reconcile —
returning a `change` would create a `ChangeResult` that stays `pending` until an
unrelated sync runs, and never settles at all while UniFi is unconfigured.

Settings is in the web app: UniFi key replacement, managed VLANs, timezone (Gateway card), family roles, and adult logins.

## Companion connection and HTTPS

The household administrator owns connection routes. Each route is a HTTPS origin with a
transport label (`lan` for any home-network address — direct, over a VPN, or behind a reverse
proxy — `tailscale`, or `cloudflare`) and a `kind` saying who runs it: FamilyFi's `quick` tunnel,
FamilyFi's `domain` tunnel on the household's Cloudflare domain, or the household's `own`. Phones
see both as labels only. FamilyFi stores two credentials for a tunnel provider, both encrypted: the
`domain` route's tunnel credential, which is never served, and an `own` Cloudflare route's Access
service token, which is served only to phones (below).

### Cloudflare Access service tokens

An `own` route with transport `cloudflare` may sit behind Cloudflare Access. Phones then send
`CF-Access-Client-Id` and `CF-Access-Client-Secret` to that route's origin — and to no other
route. The token reaches a phone three ways, and no other:

- the pairing code's `access` (`clientId`, `clientSecret`), so a phone can reach the protected
  route to pair;
- the claim response's signed manifest; and
- the signed manifest in `GET /api/v1/connection` for a paired device's bearer session.

Every route says whether Access guards it (`edgeAuth`: `none` or `serviceToken`) and the current
token's `edgeTokenVersion`, but never the token. A paired device's signed payload adds
`edgeCredentials`: `[{ endpointId, version, clientId, clientSecret }]` for each enabled protected
route; a browser session's manifest never carries it. Each time a device is handed a token, its
version is recorded, and `GET /api/v1/connection/devices` reports it as `edgeTokens`, so Pair Device
can show who still holds an old one after a replacement. `version` rises each time the
operator replaces the token; a phone replaces what it holds whenever a verified manifest carries a
higher one. The phone gateway strips both headers before a request reaches the app.

Cloudflare refuses a request without a valid token before it reaches FamilyFi: a **401** (with the
Access application's "Return 401 response for Service Auth policies" on, as the operator guide
asks), a **403**, or — if the application also has identity policies — a **302** to
`<team>.cloudflareaccess.com`. None carries FamilyFi's JSON error body. A phone treats any of them
as that route being unavailable and fails over; it never signs out over one. A phone that missed a
replacement entirely is turned away until it is paired again.

Remote access publishes one route at a time: `PUT /api/v1/connection/tunnel` turns the chosen route
on and every other route off, so the signed manifest carries exactly that route (or none while off).

`system` routes use ordinary iOS hostname and certificate-chain validation. Use them for a
valid LAN certificate, VPN, public reverse proxy, Tailscale Serve, or Cloudflare. A `pinned`
route is limited to `lan` and carries an SHA-256 SPKI pin in the pairing code; a phone
rejects every other public key. FamilyFi does not distribute a household CA.

Administrators do all of this from **System → Pair Device** in the web app. Administrator reads need only the session; writes also need the CSRF header.

Pairing is separate from sign-in: an administrator generates a five-minute, single-use QR
for an enabled endpoint; the phone claims it, verifies the instance identity, stores its
device credential in Keychain, and then signs in normally with its household account.
Native bearer sessions are tied to that paired phone. Revoking the phone invalidates every
one of its bearer sessions and requires a new pairing.
The iPhone may automatically enroll its reachable Watch without another administrator pairing.
The Watch receives its own device credential and bearer token, appears as a separate device in
System → Pair Device, and can be revoked there independently. Its sessions may only read session,
connection, group, and change state or pause, resume, and extend groups. The three group controls
reject protected and adult Family groups for Watch sessions. Signing out or revoking the phone does
not revoke the Watch. Its bearer expires after 30 days; automatic renewal is a separate change.

The server signs endpoint manifests using its persisted Ed25519 instance key. A phone may
accept a pin change only in a manifest signed by the already trusted key; any other identity
or pin change requires a new administrator-generated pairing.

The signed-in **System → API** page (`/reference`) renders this OpenAPI file with Swagger UI. Try it out sends the session cookie and CSRF header. `GET /openapi` returns the YAML and requires a session.

CI holds the implementation to this document: `pnpm test-api` fails when a route or method is missing from it, and every response the integration tests receive must use a status documented for that route and, when JSON, match its schema.

## Versioning the contract

The iOS client ([`familyfi-ios`](https://github.com/nickberardi/familyfi-ios)) vendors a copy of `openapi/familyfi.v1.yaml` and generates its client from it, so `info.version` is how it tells that its copy is stale. Every pull request that changes the document raises `info.version`, and `package.json`'s version with it (`tests/unit/version.test.ts` keeps the two equal). `scripts/check-openapi-version.mjs` enforces the rule against the base branch:

| The pull request changes | `info.version` must |
| --- | --- |
| Nothing in the parsed document | Nothing to check |
| Only `description` or `summary` text | Increase; a patch is enough |
| Anything else: a path, parameter, schema, enum value or status | Increase by at least a minor version |
| Anything, with the `breaking_api` label | From 1.0.0 on, increase by a major version. Before 1.0.0 a minor increase carries the break, as semver allows for `0.y.z` |

A major increase needs the `breaking_api` label, which only the operator adds. The version increases once per pull request, not once per release, so two contract changes merged between releases are two versions and the iOS copy can tell which one it has. The `OpenAPI` workflow's job summary names the old and new version as a reminder to refresh `familyfi-ios/openapi/familyfi.v1.yaml`; it posts nothing outside this repository.

Run the check locally with `make test-api-version`, or against any ref with `node scripts/check-openapi-version.mjs <ref>`.
