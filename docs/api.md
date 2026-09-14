# API

The web UI and any future native client use `/api/v1`. The source of truth is [`openapi/familyfi.v1.yaml`](../openapi/familyfi.v1.yaml). Mutations return a `change` object (`changeId` + `revision`); poll `GET /api/v1/changes/{id}` for that action. Global last-sync success is not proof that your change applied.

Browser mutations after login send `X-CSRF-Token` matching the `familyfi_csrf` cookie. Native clients send `Authorization: Bearer`.

Normal payloads never return password hashes, `DEFAULT_PASSWORD`, raw UniFi keys, or firewall JSON.

## Implemented

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/health` | No secrets; includes `version` from `package.json` |
| POST | `/api/v1/auth/login` | Cookie session or native bearer |
| POST | `/api/v1/auth/logout` | CSRF for cookies; bearer for native |
| GET | `/api/v1/auth/session` | Current principal |
| GET/POST | `/api/v1/accounts` | Personal adult accounts; recovery `admin` is listed and cannot be created here |
| GET/PUT/DELETE | `/api/v1/accounts/{id}` | Recovery admin cannot be edited or deleted |
| PUT | `/api/v1/accounts/{id}/password` | Revokes that account's sessions; recovery uses `.env` |
| GET/PUT | `/api/v1/settings/household` | IANA timezone; `quarantineEnforced` false is an emergency UniFi `enabled: false` on quarantine policies |
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

Settings is in the web app: UniFi key replacement, managed VLANs, timezone (Gateway card), family roles, and adult logins.

The signed-in **System → API** page (`/reference`) renders this OpenAPI file with Swagger UI. Try it out sends the session cookie and CSRF header. `GET /openapi` returns the YAML and requires a session.
