# API

The web UI and native clients use `/api/v1`. The source of truth is [`openapi/familyfi.v1.yaml`](../openapi/familyfi.v1.yaml). Mutations that enqueue reconciliation return a `change` object (`changeId` + `revision`); poll `GET /api/v1/changes/{id}` for that action. Consult the endpoint schema: authentication, pairing and other operations that do not enqueue reconciliation have their own response shapes. Global last-sync success is not proof that your change applied.

Browser mutations after login send `X-CSRF-Token` matching the `familyfi_csrf` cookie. Native clients send `Authorization: Bearer`.

A response field the server always sends is `required` in the document, and an empty one is `null`, never left out, so a generated client never sees it as possibly absent. The few fields the server does leave out are listed in [`tests/contract/openapi.test.ts`](../tests/contract/openapi.test.ts), which fails when a response schema leaves any other field optional.

Normal payloads never return password hashes, `FAMILYFI_DEFAULT_PASSWORD`, raw UniFi keys, or firewall JSON.

## Shared behaviour and consumer adoption

This repository owns two distinct shared artifacts:

| Artifact | What it establishes | Validation |
| --- | --- | --- |
| [OpenAPI specification](../openapi/familyfi.v1.yaml) | HTTP paths, request/response shapes, statuses and authentication contract | API checks and schema-validated integration responses; [authorization matrix](../tests/integration/authorization-matrix.test.ts) for caller permissions |
| [Display vectors](../tests/fixtures/display-vectors.json) | Examples of shared labels, available actions and time-dependent display behaviour | [Vector tests](../tests/unit/display-vectors.test.ts); format and update rules in [testing](testing.md#display-vectors) |

Schema compatibility does not prove behavioural compatibility. Pause/Resume meaning, allowances,
household timezone, per-action outcomes and unknown DNS verdicts must remain consistent across
clients. The fixtures cover the functions named by their test harness; they are not evidence of
complete UI parity, all API semantics or live gateway enforcement.

A server in [demo mode](operations.md#demo-mode) refuses configuration writes with 403
`demo_locked`: `PUT /settings/household`, `PUT /settings/unifi`, account and password writes,
`PUT`/`DELETE` on `/upstream/resolver` and `/groups/{id}/resolver`, route writes under
`/connection/endpoints`, `POST /connection/pins`, `PUT /connection/tunnel`, `PUT /update/schedule`,
`POST /update/install`, and `GET /settings/export` and `POST /settings/import`. Clients show the message; the household
itself (groups, rules, pauses, devices) and pairing are unchanged.

For a change to either shared artifact:

1. Identify the affected consumers and intended behaviour before editing. Follow the [root compatibility rules](../AGENTS.md#openapi-consumer-coordination) and [version policy](#versioning-the-contract) for HTTP changes.
2. Change the owning implementation and applicable artifact in the same PR. Add meaningful cases for changed shared display behaviour; do not change expected results merely to accept a regression.
3. Run the applicable [validation](testing.md). Describe changed endpoints/schemas or vector cases, the server commit/version to adopt, and any rollout dependency in the PR.
4. For an OpenAPI change, open the required `familyfi-mobile` adoption issue as specified in `AGENTS.md`. For display changes, make the behaviour and vector diff explicit in the PR so familyfi-mobile's Watch port can adopt them together.
5. Use the [native repository's current adoption instructions](https://github.com/nickberardi/familyfi-mobile/blob/main/docs/development.md#paired-familyfi-changes) for its refresh, generation and validation procedure. Keep those commands there. A passing server check does not establish that a consumer has adopted the change.

Platform-specific navigation, typography and layout are owned by each implementation; use the
[design ownership map](development.md#design-ownership) when comparing them.

## Implemented

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/health` | No secrets; includes `version` from `package.json` and an additive cached GitHub update-check snapshot. `update.available` is `null`, never `false`, while checking or after a GitHub failure. |
| POST | `/api/v1/auth/login` | Browser cookie session only; paired devices join by invite. Administrators only (403 `administrator_account_required` otherwise). Refused through remote access |
| POST | `/api/v1/auth/refresh` | A paired device trades its refresh token for a new one-hour bearer and a new refresh token; reuse of a replaced one ends the sign-in |
| POST | `/api/v1/auth/logout` | CSRF for cookies; bearer for paired devices |
| GET | `/api/v1/auth/session` | Current principal, and the household's `timezone`, which a Watch cannot read from settings |
| GET/POST | `/api/v1/accounts` | Personal adult accounts; recovery `admin` is listed and cannot be created here |
| GET/PUT/DELETE | `/api/v1/accounts/{id}` | Recovery admin cannot be edited or deleted; an adult who stops being an administrator (`isAdmin: false`) is signed out everywhere: their sessions end, every phone, Watch and agent acting as them is removed, and their pending invites are cancelled |
| PUT | `/api/v1/accounts/{id}/password` | Revokes that account's sessions; recovery uses `.env` |
| GET/PUT | `/api/v1/settings/household` | IANA timezone; `quarantineEnforced` false (a new household's default) keeps quarantine policies on UniFi with `enabled: false`. It is the built-in quarantine rule's switch, and turning it off ends a pause on that rule |
| GET | `/api/v1/connection/identity` | Public household identity for pairing; never returns a credential or UniFi state |
| GET | `/api/v1/connection` | Authenticated endpoint manifest, FamilyFi-to-UniFi status, and the account's last attributed change |
| GET/POST | `/api/v1/connection/endpoints` | Every saved route with its `kind` (`quick`, `domain`, `own`), and whether Cloudflare Access guards it (`edgeAuth`, `edgeTokenVersion`). POST adds a route the household runs; publish it through `/connection/tunnel` |
| PUT/DELETE | `/api/v1/connection/endpoints/{id}` | Update or remove a route the household runs. A write-only `serviceToken` puts an `own` `cloudflare` route behind Cloudflare Access (a different token replaces it); `edgeAuth: none` turns Access off; any other route is 409 `access_unsupported`. A duplicate address is 409 `endpoint_exists`; deleting a route while an unclaimed pairing uses it is 409 `endpoint_in_use`; a `quick` or `domain` route is 409 `managed_route`. Deleting the published route turns remote access off |
| GET/PUT | `/api/v1/connection/tunnel` | Remote access: publish one route — `off`, `quick`, or `named` with a `hostname` (FamilyFi's Cloudflare tunnel on your domain) or an `endpointId` (a route you run). Every other route is turned off |
| POST | `/api/v1/paired/invites` | Invite a device to join. An administrator invites a phone (`client: phone`, its route, the administrator it signs in as; five minutes) or an agent (`client: agent`, `scope`; fifteen minutes, home network only) and gets a single-use `code`. With `?claim=true`, a signed-in paired phone invites and claims its Watch in one call |
| GET/PUT | `/api/v1/connection/home` | Administrator reads or sets the home network address: where FamilyFi is inside the home (an http or https origin, 400 `invalid_home_url` otherwise; `null` clears it), apart from the route remote access publishes. Both answer `current`, the address this request reached and whether it is `private`, which stands in while none is saved. Agents pair there |
| POST | `/api/v1/connection/pins` | Administrator computes a route's SPKI pin from its live address (TLS handshake only) or a pasted PEM; stores nothing |
| GET/DELETE | `/api/v1/paired/invites/{id}` | Administrator reads an invite's status (`pending`, `claimed`, `expired`) or cancels it early |
| POST | `/api/v1/paired/invites/{id}/claim` | Join with the code: every client is signed in at once (bearer and refresh token, never a password or device credential); a phone also gets its route and signed manifest |
| GET | `/api/v1/paired/devices` | Paired devices with each one's `scope`, the account it acts as (`actsAs`) and its parent: all of them for an administrator, itself and its Watch for a paired device; `?client=` and `?status=` narrow it; the route each phone paired through (`pairedVia`), the Cloudflare Access token version it last received per route (`edgeTokens`), and active sessions |
| GET/PATCH/DELETE | `/api/v1/paired/devices/{id}` | Read one; an administrator renames it or changes an agent's scope; an administrator, the device itself or its parent phone revokes it and its sessions. Only an administrator may use `?remove=true` to delete its record |
| DELETE | `/api/v1/paired/devices?status=revoked` | Administrator removes every revoked device's record; active ones are untouched |
| GET/PUT | `/api/v1/settings/unifi` | Masked key; PUT probes then encrypts. Network allowlist: `manageAllNetworks` or `managedNetworkIds` |
| GET | `/api/v1/settings/export` | Administrator, in a browser (a paired device gets 403 `browser_session_required`), downloads the household as `.tar.gz`: `manifest.json`, `config.json` (no secrets) and, where `pg_dump` reaches the database, `database.dump` ([backup and restore](operations.md#backup-and-restore)) |
| POST | `/api/v1/settings/import` | Administrator, in a browser, previews (`?mode=preview`) or applies (`?mode=apply`) an export, sent as the raw body. Apply replaces groups, rules, devices, accounts, DNS categories and settings and returns a `change`; keys saved here are kept. 400 `invalid_export`, 409 `export_too_new`, 413 `export_too_large` |
| GET | `/api/v1/update` | Administrator reads whether the Watchtower updater is set up, the automatic schedule, its next run and the last install (`requested`, `succeeded`, `failed`, `skipped`, `unchanged`) |
| PUT | `/api/v1/update/schedule` | Administrator sets automatic installs: `enabled`, `days` and a household-local `time`; Sunday at midnight by default |
| POST | `/api/v1/update/install` | Administrator installs the newer release now through Watchtower; 202 with the run. 409 `updater_not_configured`, `no_update_available` or `update_in_progress`; 502 `updater_unreachable` |
| POST | `/api/v1/settings/unifi/test` | Probe without saving; returns site networks (id, name, vlanId) |
| GET/POST | `/api/v1/groups` | Family/Things |
| GET/PUT/DELETE | `/api/v1/groups/{id}` | Delete quarantines member devices |
| GET/POST | `/api/v1/rules` | Household rules: `kind` (`internet`, `category`, `app`, `domain`), `groupIds` or managed `networkIds`, `mode` and named `windows`. `policyNames` is what UniFi's policy table shows. `?groupId` narrows the list. The list leads with the built-in quarantine rule (id `quarantine`, `builtIn: "quarantine"`, no `groupIds`): its `enabled` is `quarantineEnforced`, its policies the quarantine policies; it is switched, paused, extended and resumed, never edited, deleted or allowed (409 `rule_built_in`). A Watch or agent may pause it but not switch it |
| GET/PATCH/DELETE | `/api/v1/rules/{id}` | PATCH changes anything but `kind` and `scope`; `windows` replaces the list, and a window sent with its `id` keeps its UniFi policy. DELETE removes the rule's recorded policies |
| POST | `/api/v1/rules/{id}/off` | Turns a rule off; its policies stay, disabled. Ends any pause on it |
| POST | `/api/v1/rules/{id}/on` | Turns a rule on |
| POST | `/api/v1/rules/{id}/pause` | Suspends the rule for every group it covers until `until` (empty body or `null` = until resumed) by disabling its policies. Records who paused it and replaces an earlier pause or allowance. 400 for an `until` in the past; 409 `rule_off` when the rule is off |
| POST | `/api/v1/rules/{id}/resume` | Ends a pause. An allowance is ended by `disallow`; ending the other kind changes nothing and still returns 200 |
| POST | `/api/v1/rules/{id}/extend` | Adds `minutes` to a timed pause. 409 `not_paused` (an allowance is not extended), `indefinite` or `rule_off` |
| POST | `/api/v1/rules/{id}/allow` | Overrides the rule, like a pause but recorded as an allowance. Default `until` is when the windows active now end (until disallowed for an always-on rule); 409 `not_in_window` when none is active, `rule_off` when the rule is off |
| POST | `/api/v1/rules/{id}/disallow` | Ends an allowance; a pause is ended by `resume` |
| POST | `/api/v1/groups/{id}/rules/{ruleId}/(pause\|resume\|extend\|allow\|disallow)` | The same five verbs for one group alone: its devices leave the rule's policies (a policy left with no one stays disabled with its devices). Same requests, states and errors as the rule-wide routes; 404 when the group does not have the rule. Rules list the active ones as `groupPauses`. `ruleId` may be the reserved `internet`, a group's built-in rule "this group has internet", and the verbs mean the same to it: `pause` suspends it (blocks all internet now; a hidden always-on block rule is enabled until `until` or until resumed, and its policy exists only meanwhile), `resume` ends that, `extend` adds time to it, `allow` overrides the group's internet rules until `until` (default: each rule's active windows end; 409 `not_in_window` when none is blocking), `disallow` ends that. Pause and allow replace each other. The response is `{ group, change }`. `Group.suspension`, `allowance` and `access` are read from these rules |
| GET | `/api/v1/devices` | `?assignment=assigned` or `quarantined` |
| GET/DELETE | `/api/v1/devices/{mac}` | GET includes `unresolved` when zone is unknown; DELETE removes the record and assignment, then sync rediscovers a still-present in-scope device as quarantined |
| PUT | `/api/v1/devices/{mac}/assignment` | `{ "groupId": "…" }` or `null` for quarantine |
| GET | `/api/v1/sync` | Revision, last run, app-owned policy counts, recent changes |
| POST | `/api/v1/sync/retry` | Enqueue another run |
| GET | `/api/v1/changes/{id}` | Per-action status |
| GET/POST | `/api/v1/upstream/categories` | Domain-list categories with their domains and last verdict, including each check's per-domain results. **No `change` object** — see below |
| GET/PATCH/DELETE | `/api/v1/upstream/categories/{id}` | `domains` is the whole *active* list and replaces what is stored. A built-in category cannot be renamed or deleted |
| POST | `/api/v1/upstream/categories/{id}/check` | Check one category now; 200 even when the resolver was unreachable |
| GET | `/api/v1/upstream/checks` | Latest verdict per category, including source and per-network results; results older than seven days are omitted |
| POST | `/api/v1/upstream/checks/run` | Sweep every category with checking on |
| GET/PUT/DELETE | `/api/v1/upstream/resolver` | Effective household source (`dhcp`, `doh`, or `unknown`), discovered servers, optional DoH override, and check schedule. New households default to Sunday at midnight; existing schedules remain. Turning checking off clears previous verdicts. Removing DoH resumes DHCP discovery |
| GET/PUT/DELETE | `/api/v1/groups/{id}/resolver` | GET shows a group's effective source and discovered networks; PUT/DELETE set or remove its DoH override and invalidate affected verdicts |

Both device GET responses include `presence`, `presenceCheckedAt`, `connectedAt`, `connectionType`, `accessPointName`, and `manufacturer`. Presence is `online`, `offline`, `stale_online`, `stale_offline`, or `unknown`; the last-known forms mean the successful client observation is over 90 seconds old. A failed UniFi read does not mark devices offline. Manufacturer is the public IEEE MAC registrant recorded at the last sync, not a verified hardware model; it is null for private or unlisted addresses and until a sync next sees the device connected. Connection fields can be null when unavailable or offline.

The `upstream` resource never returns the `change` envelope. Those rows are
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
version is recorded, and `GET /api/v1/paired/devices` reports it as `edgeTokens`, so Pair Device
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

### Pairing

Every paired device joins through `/paired/invites` and is managed through `/paired/devices`.
Pairing is the authentication: an invite names the account the device acts as, and claiming it
signs the device in, with no password and no device credential. An administrator invites a phone
with a five-minute, single-use QR for an enabled route and chooses which administrator it signs in
as (only administrators have paired phones: an invite for any other account is refused, 400
`administrator_account_required`);
the phone claims it, verifies the instance identity, and is signed in, with its route and signed
manifest in the claim. Bearer sessions are tied to that paired phone. Revoking the phone
invalidates every one of its sessions, and its Watches', and requires a new invite. Sign-in with a password is for
browsers only.

A paired device's bearer lasts one hour. Its claim also returns a `refreshToken`, which the device trades at `POST /api/v1/auth/refresh` for a new bearer and a new
refresh token, before or after the bearer expires. The refresh token lasts 90 days from its last
use and is spent by each refresh: the one just replaced is honoured once within ten seconds, for a
device that lost the response, and presenting it after that ends the whole sign-in
(403 `refresh_reused`), because a copy exists. Both tokens live on one session, so revoking the
device, signing out, a password change or removing the account ends them together. Removing an
account also removes the paired devices that act as it.
The iPhone invites and claims its reachable Watch in one call (`POST /paired/invites?claim=true`),
without an administrator: the Watch makes no network call to join, the phone hands it its bearer,
refresh token and manifest, and the phone is recorded as its parent. The Watch acts as the phone's
account, appears as a separate device in System → Pair Device, and can be revoked there, by itself
or by its phone. Its scope is `rulesOnly`: its sessions may only read session,
connection, group, rule and change state, pause, resume, extend and allow any group, and pause,
resume, extend, allow, disallow, turn on and turn off any rule, or lift one for a single group; role never limits a control. They cannot
create, edit or delete rules. A phone may set up several Watches. Revoking or removing the phone
revokes its Watches too; signing the phone out does not. It renews its own bearer with its own
refresh token.

### Agents

An administrator connects an AI agent with **Connect an agent** on **System → Pair Device** (`/pair`): name it, choose a
scope (**Full access** or **Read only**), and copy the prompt shown. The prompt points the agent at `/agents.md`, a guide served
without a session from [`openapi/agent-guide.md`](../openapi/agent-guide.md) with this server's
address filled in, and carries an agent pairing code. That code is single-use, expires in fifteen
minutes, and carries the household's home network address (`/connection/home`), or the address it
was made at when none is set; the invite response repeats it as `url` for the prompt. It names no
route, certificate pin or Cloudflare Access token. The home network address is what lets a household
that reaches the web app through a proxy with its own sign-in, such as Cloudflare Access email login,
still connect an agent: the agent cannot get past that sign-in page, so it pairs at the inside address.

The agent never sends a password. It claims the code at
`POST /api/v1/paired/invites/{id}/claim`, like a phone: the claim returns a one-hour bearer and a
refresh token, with no route, manifest or device credential. It renews at
`POST /api/v1/auth/refresh` like any paired device, so the refresh token is its only long-lived
secret: it rotates on every use and lapses after 90 days unused. It acts as the adult who made
the pairing. Only administrators use FamilyFi, so its scope, not that account, bounds it: `agent:full` or `agent:readOnly`, never accounts, UniFi settings, resolvers,
household-settings changes or connection management (403 `agent_scope`). It
is refused through FamilyFi's remote access tunnel (403 `agent_remote`), at its claim, its refresh
and every call; like browser sign-in, an
address the household publishes itself is the household's choice. Agents are paired devices: they appear in `GET /paired/devices` with
`client: agent`, an administrator may change their scope, and they are revoked like a phone, by an
administrator or by themselves. The
[authorization matrix](../tests/integration/authorization-matrix.test.ts) names, for each route,
which device scopes may call it.

### Device scopes

Every paired device has a `scope` (`DeviceScope`), and each (client, scope) pair is one explicit
allowlist in [`src/server/device-scope.ts`](../src/server/device-scope.ts), not a ladder:

| Pair | May call |
| --- | --- |
| `phone:full` | Whatever its account may |
| `watch:rulesOnly` | Its session, connection manifest, groups, rules and changes; the rule and group-rule verbs; revoking itself (403 `watch_scope` beyond that) |
| `agent:full` | Household reads and controls; never accounts, UniFi settings, resolvers, household-settings changes or connection management |
| `agent:readOnly` | Household reads |

No other pair is valid. A phone always pairs as `full` and a Watch enrolls as `rulesOnly`; an
administrator chooses an agent's scope when connecting it.

The server signs endpoint manifests using its persisted Ed25519 instance key. A phone may
accept a pin change only in a manifest signed by the already trusted key; any other identity
or pin change requires a new administrator-generated pairing.

The signed-in **System → API** page (`/reference`) renders this OpenAPI file with Swagger UI. Try it out sends the session cookie and CSRF header. `GET /openapi` returns the YAML and requires a session: a browser cookie, or a phone's or agent's bearer.

CI holds the implementation to this document: `pnpm test-api` fails when a route or method is missing from it, and every response the integration tests receive must use a status documented for that route and, when JSON, match its schema.

## Versioning the contract

The companion app ([`familyfi-mobile`](https://github.com/nickberardi/familyfi-mobile)) vendors this repository as its `vendor/familyfi` submodule and generates its API types from `openapi/familyfi.v1.yaml` (`pnpm run schema`), so `info.version` names which contract revision a pin carries. Every pull request that changes the document raises `info.version`, and `package.json`'s version with it (`tests/unit/version.test.ts` keeps the two equal). `scripts/ci/check-openapi-version.mjs` enforces the rule against the base branch:

| The pull request changes | `info.version` must |
| --- | --- |
| Nothing in the parsed document | Nothing to check |
| Only `description` or `summary` text | Increase; a patch is enough |
| Anything else: a path, parameter, schema, enum value or status | Increase by at least a minor version |
| Anything, with the `breaking_api` label | From 1.0.0 on, increase by a major version. Before 1.0.0 a minor increase carries the break, as semver allows for `0.y.z` |

A major increase needs the `breaking_api` label, which only the operator adds. The version increases once per pull request, not once per release, so two contract changes merged between releases are two versions, and each pin carries the one it was taken at. The `OpenAPI` workflow's job summary names the old and new version as a reminder to re-pin `familyfi-mobile`'s `vendor/familyfi` submodule and regenerate its types; it posts nothing outside this repository.

Run the check locally with `make test-api-version`, or against any ref with `node scripts/ci/check-openapi-version.mjs <ref>`.
