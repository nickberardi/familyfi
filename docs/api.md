# API

The web UI and any future native client use `/api/v1`. The source of truth is [`openapi/familyfi.v1.yaml`](../openapi/familyfi.v1.yaml). Mutations return a `change` object (`changeId` + `revision`); poll `GET /api/v1/changes/{id}` for that action. Global last-sync success is not proof that your change applied.

Browser mutations after login send `X-CSRF-Token` matching the `familyfi_csrf` cookie. Native clients send `Authorization: Bearer`.

Normal payloads never return password hashes, `FAMILYFI_DEFAULT_PASSWORD`, raw UniFi keys, or firewall JSON.

## Implemented

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/health` | No secrets; includes `version` from `package.json` |
| POST | `/api/v1/auth/login` | Cookie session, or a paired native device bearer session |
| POST | `/api/v1/auth/logout` | CSRF for cookies; bearer for native |
| GET | `/api/v1/auth/session` | Current principal |
| GET/POST | `/api/v1/accounts` | Personal adult accounts; recovery `admin` is listed and cannot be created here |
| GET/PUT/DELETE | `/api/v1/accounts/{id}` | Recovery admin cannot be edited or deleted |
| PUT | `/api/v1/accounts/{id}/password` | Revokes that account's sessions; recovery uses `.env` |
| GET/PUT | `/api/v1/settings/household` | IANA timezone; `quarantineEnforced` false is an emergency UniFi `enabled: false` on quarantine policies |
| GET | `/api/v1/connection/identity` | Public household identity for pairing; never returns a credential or UniFi state |
| GET | `/api/v1/connection` | Authenticated endpoint manifest, FamilyFi-to-UniFi status, and the account's last attributed change |
| GET/POST | `/api/v1/connection/endpoints` | Administrator-managed HTTPS connection routes |
| PUT/DELETE | `/api/v1/connection/endpoints/{id}` | Update or remove a route; deleting a route with an outstanding pairing is rejected |
| POST | `/api/v1/connection/pairings` | Administrator creates a single-use, five-minute pairing QR payload |
| POST | `/api/v1/connection/pairings/{id}/claim` | Phone consumes a pairing and receives its device credential and signed endpoint manifest |
| GET | `/api/v1/connection/devices` | Administrator list of paired phones and their active sessions |
| DELETE | `/api/v1/connection/devices/{id}` | Administrator revocation; invalidates every bearer session for that phone |
| GET/PUT | `/api/v1/settings/unifi` | Masked key; PUT probes then encrypts. Network allowlist: `manageAllNetworks` or `managedNetworkIds` |
| POST | `/api/v1/settings/unifi/test` | Probe without saving; returns site networks (id, name, vlanId) |
| GET/POST | `/api/v1/groups` | Family/Things |
| GET/PUT/DELETE | `/api/v1/groups/{id}` | Delete quarantines member devices |
| PUT | `/api/v1/groups/{id}/schedule` | Recurring bedtime stored on UniFi `schedule` |
| POST | `/api/v1/groups/{id}/pause` | Empty body = indefinite; `{ "until" }` = timed. Sets UniFi `enabled: false` |
| POST | `/api/v1/groups/{id}/resume` | Clears suspension (`enabled: true`; schedule may still block) |
| POST | `/api/v1/groups/{id}/extend` | Adds minutes to a timed pause |
| GET | `/api/v1/devices` | `?assignment=assigned` or `quarantined` |
| GET | `/api/v1/devices/{mac}` | Includes `unresolved` when zone is unknown |
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
transport label (`lan`, `vpn`, `reverseProxy`, `tailscale`, or `cloudflare`) and a priority.
FamilyFi never stores credentials for a tunnel provider.

`system` routes use ordinary iOS hostname and certificate-chain validation. Use them for a
valid LAN certificate, VPN, public reverse proxy, Tailscale Serve, or Cloudflare. A `pinned`
route is limited to direct LAN use and carries an SHA-256 SPKI pin in the pairing QR; a phone
rejects every other public key. FamilyFi does not distribute a household CA.

Pairing is separate from sign-in: an administrator generates a five-minute, single-use QR
for an enabled endpoint; the phone claims it, verifies the instance identity, stores its
device credential in Keychain, and then signs in normally with its household account.
Native bearer sessions are tied to that paired phone. Revoking the phone invalidates every
one of its bearer sessions and requires a new pairing.

The server signs endpoint manifests using its persisted Ed25519 instance key. A phone may
accept a pin change only in a manifest signed by the already trusted key; any other identity
or pin change requires a new administrator-generated pairing.

The signed-in **System → API** page (`/reference`) renders this OpenAPI file with Swagger UI. Try it out sends the session cookie and CSRF header. `GET /openapi` returns the YAML and requires a session.
