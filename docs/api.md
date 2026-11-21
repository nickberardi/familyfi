# API

The web UI and native clients use `/api/v1`. The source of truth is [`openapi/familyfi.v1.yaml`](../openapi/familyfi.v1.yaml). Mutations that enqueue reconciliation return a `change` object (`changeId` + `revision`); poll `GET /api/v1/changes/{id}` for that action. Consult the endpoint schema: authentication, pairing and other operations that do not enqueue reconciliation have their own response shapes. Global last-sync success is not proof that your change applied.

Browser mutations after login send `X-CSRF-Token` matching the `familyfi_csrf` cookie. Native clients send `Authorization: Bearer`. A browser's session counts only from its cookie: its token sent as a bearer is unauthenticated, so remote access, which strips cookies, never admits a browser session.

A response field is `required` in the document only when every object of its type has it. A field that applies to some of them only, by kind, scope, mode or built-in rule (a rule's `targetIds`, `windows` or `countries`), is optional and left out where it doesn't apply, never sent empty or as a placeholder, so a payload carries only what describes that object and doesn't grow with every feature. A list that applies but has nothing in it is `[]` (Block countries covering no group yet has `groupIds: []`), and any other field that applies but has no value is `null`; neither is left out. Every optional response field is listed, with when it is sent, in [`tests/contract/openapi.test.ts`](../tests/contract/openapi.test.ts), which fails when a response schema leaves any other field optional.

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
`/connection/endpoints`, `POST /connection/pins`, `PUT /connection/tunnel`, `PUT /settings/update/schedule`,
`POST /settings/update/install`, `GET /settings/export` and `POST /settings/import`, and a phone's alert
registration and choices (`PUT`/`DELETE /paired/devices/{id}/push`, `PUT /paired/devices/{id}/alerts`). The error carries a `link`
to installing FamilyFi at home ("Set up your own"). Clients show the message, and an error's `link` (https only) as a link
under it; the household itself (groups, rules, pauses, devices) and pairing are unchanged.

For a change to either shared artifact:

1. Identify the affected consumers and intended behaviour before editing. Follow the [root compatibility rules](../AGENTS.md#openapi-consumer-coordination) and [version policy](#versioning-the-contract) for HTTP changes.
2. Change the owning implementation and applicable artifact in the same PR. Add meaningful cases for changed shared display behaviour; do not change expected results merely to accept a regression.
3. Run the applicable [validation](testing.md). Describe changed endpoints/schemas or vector cases, the server commit/version to adopt, and any rollout dependency in the PR.
4. For an OpenAPI change, open the required `familyfi-mobile` adoption issue as specified in `AGENTS.md`. For display changes, make the behaviour and vector diff explicit in the PR so familyfi-mobile's Watch port can adopt them together.
5. Use the [native repository's current adoption instructions](https://github.com/nickberardi/familyfi-mobile/blob/main/docs/development.md#paired-familyfi-changes) for its refresh, generation and validation procedure. Keep those commands there. A passing server check does not establish that a consumer has adopted the change.

Platform-specific navigation, typography and layout are owned by each implementation; use the
[design ownership map](design.md#ownership) when comparing them.

## Implemented

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/health` | No secrets; includes `version` from `package.json` and an additive cached GitHub update-check snapshot. `update.available` is `null`, never `false`, while checking or after a GitHub failure. With `?gateway=true` it needs a session (an administrator or an `app:full` device; a Watch, an agent or an `app:rulesOnly` device gets 403) and adds `gateway`: each site device's latest CPU, memory, load and uptime from the console, gateway first, and the requests this server sent the console in the last five minutes. That costs the console a request per device, so only Settings asks, when the card opens; never poll it. |
| POST | `/api/v1/auth/login` | Browser cookie session only; paired devices join by invite. Administrators only (403 `administrator_account_required` otherwise). Refused through remote access |
| POST | `/api/v1/auth/refresh` | A paired device trades its refresh token for a new one-hour bearer and a new refresh token; reuse of a replaced one ends the sign-in |
| POST | `/api/v1/auth/logout` | CSRF for cookies; bearer for paired devices |
| GET | `/api/v1/auth/session` | Current principal, and the household's `timezone`, which a Watch cannot read from settings |
| GET/POST | `/api/v1/accounts` | Personal adult accounts; recovery `admin` is listed and cannot be created here |
| GET/PUT/DELETE | `/api/v1/accounts/{id}` | Recovery admin cannot be edited or deleted; an adult who stops being an administrator (`isAdmin: false`) is signed out everywhere: their sessions end, every phone, Watch and agent acting as them is removed, and their pending invites are cancelled |
| PUT | `/api/v1/accounts/{id}/password` | Revokes that account's sessions; recovery uses `.env` |
| GET/PUT | `/api/v1/settings/household` | IANA timezone; `quarantineEnforced` false (a new household's default) keeps quarantine policies on UniFi with `enabled: false`. It is the built-in quarantine rule's switch, and turning it off ends a pause on that rule. `alertsRelay` turns [phone alerts](#phone-alerts) on or off (off by default). `askTimeoutMinutes` (5 to 1440, default 60) and `askWaitMinutes` (0 to 1440, default 30) time a child's [asks](#asking-for-more-time) |
| GET | `/api/v1/connection/identity` | Public household identity for pairing; never returns a credential or UniFi state |
| GET | `/api/v1/connection` | Authenticated endpoint manifest, FamilyFi-to-UniFi status, and the account's last attributed change |
| GET/POST | `/api/v1/connection/endpoints` | Every saved route with its `kind` (`quick`, `domain`, `own`), and whether Cloudflare Access guards it (`edgeAuth`, `edgeTokenVersion`). POST adds a route the household runs; publish it through `/connection/tunnel` |
| PUT/DELETE | `/api/v1/connection/endpoints/{id}` | Update or remove a route the household runs. A write-only `serviceToken` puts an `own` `cloudflare` route behind Cloudflare Access (a different token replaces it); `edgeAuth: none` turns Access off; any other route is 409 `access_unsupported`. A duplicate address is 409 `endpoint_exists`; deleting a route while an unclaimed pairing uses it is 409 `endpoint_in_use`; a `quick` or `domain` route is 409 `managed_route`. Deleting the published route turns remote access off. Any update clears the route's reachability evidence |
| POST | `/api/v1/connection/endpoints/{id}/check` | Checks from home whether a route the household runs answers as this FamilyFi: it requests the route's `/api/v1/connection/identity` with the route's own trust and Access token and compares `instanceId`. Stores and returns `reachability`; a `quick` or `domain` route is 409 `managed_route` |
| GET/PUT | `/api/v1/connection/tunnel` | Remote access: publish one route — `off`, `quick`, or `named` with a `hostname` (FamilyFi's Cloudflare tunnel on your domain) or an `endpointId` (a route you run). Every other route is turned off. A published route you run always reports `status: running`; `reachability` says whether it works: `reachedAt`, the last request the remote-access port answered through it (written at most once a minute), and FamilyFi's own last check (`checkedAt`, `result`, `message`), run once on publish and on request. Publishing again clears it. Clients never show such a route as on without that evidence |
| POST | `/api/v1/paired/invites` | Invite a device to join. An administrator invites a phone, tablet or Mac (`clientType: app`; its route, the administrator it signs in as; five minutes) a child's phone (`clientType: me`; its route and `personId`; five minutes), or an agent (`clientType: agent`, `scope`; fifteen minutes, home network only) and gets a single-use `code`. With `?claim=true`, a signed-in paired app invites and claims its Watch, or its own sign-in for Siri and shortcuts (`clientType: app-controls`), in one call |
| GET/PUT | `/api/v1/connection/home` | Administrator reads or sets the home network address: where FamilyFi is inside the home (an http or https origin, 400 `invalid_home_url` otherwise; `null` clears it), apart from the route remote access publishes. Both answer `current`, the address this request reached and whether it is `private`, which stands in while none is saved. Agents pair there |
| POST | `/api/v1/connection/pins` | Administrator computes a route's SPKI pin from its live address (TLS handshake only) or a pasted PEM; stores nothing |
| GET/DELETE | `/api/v1/paired/invites/{id}` | Administrator reads an invite's status (`pending`, `claimed`, `expired`) or cancels it early |
| POST | `/api/v1/paired/invites/{id}/claim` | Join with the code: every client is signed in at once (bearer and refresh token, never a password or device credential); a phone also gets its route and signed manifest |
| GET | `/api/v1/paired/devices` | Paired devices with each one's `scope`, the account it acts as (`actsAs`) and its parent: all of them for an administrator, itself and what it set up for a paired device; `?clientType=` and `?status=` narrow it; the route each phone paired through (`pairedVia`), the Cloudflare Access token version it last received per route (`edgeTokens`), and active sessions |
| GET/PATCH/DELETE | `/api/v1/paired/devices/{id}` | Read one; an administrator renames it or changes an agent's scope (no other kind changes scope: 400 `invalid_scope`), and FamilyFi Me on a child's phone tells its own Screen Time permission (`protection` only); an administrator, the device itself or its parent phone revokes it and its sessions. Only an administrator may use `?remove=true` to delete its record |
| PUT/DELETE | `/api/v1/paired/devices/{id}/push` | The app on that device (`app:full`, its own id only: 403 `own_device_required` for anyone else, a browser included) stores or forgets its push token and alert key; see [Phone alerts](#phone-alerts) |
| GET/PUT | `/api/v1/paired/devices/{id}/alerts` | The same app reads or sets which alert kinds it gets (`{ "kinds": { "device.new": true } }`); 404 `push_not_registered` before it registered |
| DELETE | `/api/v1/paired/devices?status=revoked` | Administrator removes every revoked device's record; active ones are untouched |
| GET/PUT | `/api/v1/settings/unifi` | Masked key; PUT probes then encrypts. Network allowlist: `manageAllNetworks` or `managedNetworkIds`. A key for a different console or site first removes FamilyFi's policies from the old one; if that fails, 409 `previous_gateway_unreachable` saves nothing, and `forgetPrevious: true` switches anyway, leaving those policies there |
| GET | `/api/v1/settings/export` | Administrator, in a browser (a paired device gets 403 `browser_session_required`), downloads the household as `.tar.gz`: `manifest.json`, `config.json` (no secrets) and, where `pg_dump` reaches the database, `database.dump` ([backup and restore](operations.md#backup-and-restore)) |
| POST | `/api/v1/settings/import` | Administrator, in a browser, previews (`?mode=preview`) or applies (`?mode=apply`) an export, sent as the raw body. Apply replaces groups, rules, devices, accounts, DNS categories and settings and returns a `change`; keys saved here are kept. 400 `invalid_export`, 409 `export_too_new`, 413 `export_too_large` |
| GET | `/api/v1/settings/update` | Administrator reads whether the Watchtower updater is set up, the automatic schedule, its next run and the last install (`requested`, `succeeded`, `failed`, `skipped`, `unchanged`). Unless an install is under way, a read with a release check over five minutes old checks GitHub again first, so `GET /api/v1/health` then offers a release published or promoted since |
| POST | `/api/v1/settings/update/check` | Administrator's **Check now**: asks GitHub and the image registry again whatever the last check's age, and answers `{ update }`, as `GET /api/v1/health` reports it from then on. A check under fifteen seconds old is answered without asking again |
| PUT | `/api/v1/settings/update/schedule` | Administrator sets automatic installs: `enabled`, `days` (at least one, even while off) and a household-local `time`; Sunday at midnight by default. Stored as cron, `minute hour * * days` |
| POST | `/api/v1/settings/update/install` | Administrator installs the newer release now through Watchtower; 202 with the run. 409 `updater_not_configured` (Watchtower does not answer to FamilyFi's token), `no_update_available` or `update_in_progress`; 502 `updater_unreachable` when Watchtower answered but failed the request |
| POST | `/api/v1/settings/unifi/test` | Probe without saving; returns site networks (id, name, vlanId) |
| GET/POST | `/api/v1/groups` | Family/Things |
| GET/PUT/DELETE | `/api/v1/groups/{id}` | PUT sets `blockButtonRuleId`, the group's Block button default (one of its own category, app or website rules, or null for all internet; 400 `invalid_block_button_rule` otherwise). The card unblocks and puts back that rule with the per-group `pause` and `resume` below; what the card does is [Group states](group-states.md). Delete quarantines member devices |
| POST | `/api/v1/groups/{id}/asks` | FamilyFi Me on a child's phone asks, on its own group or a shared Thing, to be unblocked or for minutes in a rule's window; see [Asking for more time](#asking-for-more-time) |
| POST | `/api/v1/groups/{id}/asks/{askId}/decline` | A parent's Not now to the group's waiting ask |
| POST | `/api/v1/groups/{id}/unblock`, `/unblock/end`, `/unblock/extend` | Unblock lifts whatever blocks the group now, for it alone and of any kind but an always-on category, app or website rule, which it leaves on unless it is the group's Block button default: its own pause ends, and each rule blocking it is allowed for the group until its active windows end, or every rule it has until `until`. `end` ends those allowances; `extend` gives each timed one the same new end, the latest plus `minutes`. Only rules that name the group are lifted; a rule for whole networks is paused for everyone from its rule. The rules themselves are untouched. The response is `{ group, rules, change }`, `rules` being the group's own |
| GET/PUT/DELETE | `/api/v1/groups/{id}/resolver` | GET shows a group's effective source and discovered networks; PUT/DELETE set or remove its DoH override and invalidate affected verdicts |
| GET/POST | `/api/v1/rules` | Household rules: `kind` (`internet`, `category`, `app`, `domain`), `groupIds` or managed `networkIds`, `mode` and named `windows`. `policyNames` is what UniFi's policy table shows. `?groupId` narrows the list. The list leads with the built-in quarantine rule (id `quarantine`, `builtIn: "quarantine"`, no `groupIds`): its `enabled` is `quarantineEnforced`, its policies the quarantine policies; it is switched, paused, extended and resumed, never edited, deleted or allowed (409 `rule_built_in`). A Watch or agent may pause it but not switch it. The built-in Lock DNS rule (id `dns`, `builtIn: "dns"`) follows: it blocks other DNS servers and known encrypted DNS services (listed as its `domains`) for its `groupIds` or whole `networkIds`, always while on, leaving the DNS servers the household's networks hand out and the resolvers set in FamilyFi reachable. Only `enabled`, what it applies to and `blockPrivateRelay` change: `scope` with `groupIds` or managed `networkIds`, checked as for any rule, and a patch naming only one of the lists takes that scope; `blockPrivateRelay` (experimental) adds a fifth policy blocking Apple's relay names, so iPhones turn iCloud Private Relay off for the network; `openDns` lists the DNS it left open at its last sync, by where each comes from; switched on with no group, and none named in the same request, it covers every family group; it is paused and allowed like any rule and cannot be deleted. Next comes Block countries (id `countries`, `builtIn: "countries"`): one always-on policy with UniFi's region filter that stops its groups' devices, or everything on its networks, reaching servers in `countries` (ISO codes). PATCH takes only its `enabled`, what it applies to (as Lock DNS) and `countries`; switched on with no groups it covers every group, and a new group joins while it covers every group. It is never deleted. Every other rule keeps the `scope` it was made with |
| GET/PATCH/DELETE | `/api/v1/rules/{id}` | PATCH changes anything but `kind`, and `scope` only on Lock DNS and Block countries; `windows` replaces the list, and a window sent with its `id` keeps its UniFi policy. DELETE removes the rule's recorded policies |
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
| GET | `/api/v1/sync` | Revision, last run, app-owned policy counts, recent changes (each with `actor`, who asked: the adult and the paired device they used; never served to an agent), and `checkupProblems` for the Checkup badge (a newer FamilyFi release counts as one) |
| POST | `/api/v1/sync/retry` | Enqueue another run |
| GET | `/api/v1/changes/{id}` | Per-action status, with `actor` as on `/sync` |
| GET | `/api/v1/checkup` | The network checkup's last findings (problems, then notes that may be on purpose), each with a `message` (see [Values that grow](#values-that-grow)), and the checks that passed. Sync runs it at most hourly from what it already read plus the Wi-Fi networks and firewall policies; it only reads the gateway. The `gateway_drift` note (a FamilyFi rule changed in UniFi, which sync changes back) is updated after every sync pass; while changing it back fails, `POST /api/v1/sync/retry` tries again. The `update_available` problem (a newer FamilyFi release) comes from the hourly release check instead: reading this or `GET /api/v1/sync` records it when the check's answer changed, so it can show before the first run, and dismissing it lasts until a newer release |
| POST | `/api/v1/checkup/run` | Check now; 409 `unifi_not_configured` before UniFi is set up |
| PATCH | `/api/v1/checkup/findings/{id}` | `{ "dismissed": true }` dismisses a problem or marks a note intended until what it is about changes; `false` shows it again |
| POST | `/api/v1/checkup/leftover-policies/remove` | Administrators only. `{ "policyIds": [...] }` removes leftover policies (`leftover_policies`: named with FamilyFi's prefix, claimed by no FamilyFi record) the administrator ticked and confirmed. Each is checked against the gateway again first; one that is gone, renamed or now FamilyFi's is in `skipped`, never deleted. One the gateway refuses to delete is in `failed`. Returns `{ checkup, removed, skipped, failed }`. 403 `demo_locked` in the demo; 409 `sync_running` while a sync pass holds the gateway |
| GET/POST | `/api/v1/upstream/categories` | Domain-list categories with their domains and last verdict, including each check's per-domain results. **No `change` object** — see below |
| GET/PATCH/DELETE | `/api/v1/upstream/categories/{id}` | `domains` is the whole *active* list and replaces what is stored. A built-in category cannot be renamed or deleted |
| POST | `/api/v1/upstream/categories/{id}/check` | Check one category now; 200 even when the resolver was unreachable |
| GET | `/api/v1/upstream/checks` | Latest verdict per category, including source and per-network results; results older than seven days are omitted |
| POST | `/api/v1/upstream/checks/run` | Sweep every category with checking on |
| GET/PUT/DELETE | `/api/v1/upstream/resolver` | Effective household source (`dhcp`, `doh`, or `unknown`), discovered servers, optional DoH override, and check schedule. New households default to Sunday at midnight; existing schedules remain. Turning checking off clears previous verdicts. Removing DoH resumes DHCP discovery |

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
Access application's "401 Response for Service Auth policies" on, as the operator guide
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

A phone tries the enabled routes in manifest order (`src/lib/companion-request.ts`
`orderRoutes`), except that on cellular a `lan` route goes last, since it answers there only over
a VPN. It starts at the route that last answered on the network it is on (Wi-Fi networks told apart
by subnet where the platform reports one), kept between launches. A read gives a `lan` route
`LAN_CONNECT_TIMEOUT_MS` to connect when another route could answer instead; a household write
keeps the whole timeout, since it never moves to another route. The one write that does move on is
a device revoking itself when it unpairs (`DELETE /paired/devices/{its id}`), which starts at the
route that last answered: a second arrival is refused (401, or 404) and changes nothing, and a
phone unpaired away from home would otherwise stop at its home route and stay paired.

Administrators do all of this from **System → Pair Device** in the web app. Administrator reads need only the session; writes also need the CSRF header.

### Phone alerts

FamilyFi can tell administrators' phones when devices join a managed network and wait in
Unassigned (`device.new`), when no sync pass has reached the gateway for 10 minutes (`sync.down`),
when one does again (`sync.up`, only to phones told `sync.down`), and when a child asks for more
time in FamilyFi Me (`ask.new`, made by the child's request rather than a sync pass), when a
child's phone says its Screen Time permission is no longer on (`me.protection`, made by that phone's
request) and when a child's phone has not reached FamilyFi for a day (`me.quiet`, once, by the sync
pass's sweep, until the phone is heard from again). Kinds are listed once in
`src/lib/alert-kinds.ts`. Reminders that a pause or allowance is ending are scheduled on the phone
and never sent by the server.

- An administrator turns alerts on with `alertsRelay` on `PUT /settings/household`; it is off by
  default and in every new household. While it is off, and always in demo mode, nothing is sent.
- The app registers itself with `PUT /paired/devices/{id}/push`: platform, channel, its push token,
  a 32-byte key it generated, the envelope version it reads (`format`) and the kinds it understands.
  Only the app on that device may (403 `own_device_required`); Watches, Siri's `rulesOnly`
  sign-in and agents are refused by their scope. Revoking or removing the device deletes the
  registration.
- Each alert is a short JSON envelope, `{"v":1,"i":"<event id>","t":<unix seconds>,"k":"<kind>","d":{...}}`,
  with no sentence in it: the phone writes the words from `k` and `d` (`src/lib/alert-copy.ts`).
  `device.new` carries `n`, the number of new devices, and `h`, the hostname when `n` is 1.
  `ask.new` carries `g` and `n`, the group's id and name, `a` (`pause` or `rule`), and for a rule
  `r`, its name, and `m`, the minutes asked for; a tap opens the group. `me.protection` and
  `me.quiet` carry `p`, the phone's name, and `g` and `n`, its family member's group id and name; a
  tap opens that family member. Readers
  ignore keys they do not know; `v` rises only for an incompatible envelope.
- FamilyFi encrypts the envelope for each phone with its key: base64url of
  `0x01 || 12-byte nonce || AES-256-GCM ciphertext || 16-byte tag`, additional data
  `familyfi-alert-v1` (`src/server/alerts/payload.ts`, vectors in `tests/fixtures/alert-vectors.json`).
- It posts the ciphertext to the project relay, `https://push.getfamilyfi.com` (or
  `FAMILYFI_ALERTS_RELAY_URL`), at `POST /v1/send` with `Authorization: Bearer <install secret>` and
  `{ installId, platform, channel, token, ciphertext, collapse, ttl }`. The install id and secret come
  from `POST /v1/installs` on the first send and are kept encrypted. The relay answers 2xx (sent),
  410 (the token is dead: FamilyFi drops the registration), 401 (unknown install: FamilyFi asks for a
  new one), 429 or 5xx (FamilyFi retries with backoff, and gives up after a day). The relay sees the
  push token, the platform and channel, the ciphertext, the install id and the time, and keeps
  nothing. `ttl` is the same for every kind (12 hours), and `collapse` is a random id, so neither
  says which kind an alert is.
- Only a device still signed in gets alerts: one revoked, or whose sessions a password change,
  sign-out or 90 idle days ended, gets nothing, though its registration stays until it is removed.
- "Gateway reached" goes only to a device that got "Can't reach your gateway"; an unsent trouble
  alert is dropped when the gateway is reached again.
- New-device alerts are one per sync pass, never on the household's first pass, and at most four an
  hour for each phone.

### Pairing

Every paired device joins through `/paired/invites` and is managed through `/paired/devices`.
Pairing is the authentication: an invite names the account the device acts as (for a child's
phone, the family group it signs in for: see [FamilyFi Me](#familyfi-me-on-a-childs-phone)), and claiming it
signs the device in, with no password and no device credential. An administrator invites a phone
with a five-minute, single-use QR for an enabled route and chooses which administrator it signs in
as (only administrators have paired phones: an invite for any other account is refused, 400
`administrator_account_required`, and the recovery account is refused too, 400
`personal_account_required`);
the phone claims it, verifies the instance identity, and is signed in, with its route and signed
manifest in the claim. The phone is called the name the administrator gave its invite; the claim's
`deviceName` names only an agent. Bearer sessions are tied to that paired phone. Revoking the phone
invalidates every one of its sessions, and its Watches', and requires a new invite. Sign-in with a password is for
browsers only.

No device acts as the recovery account. An agent acts as whoever connects it, so connecting one
while signed in as `admin` is refused (403 `personal_account_required`), and an invite, Watch, bearer or refresh
left over for the recovery account is refused too. An invite a paired phone makes records that
phone as the new device's `parentDeviceId`; revoking or removing a device revokes everything paired
from it, recursively, and cancels the invites they left waiting. A re-paired phone takes the old
record's place and keeps its parent.

A paired device's bearer lasts one hour. Its claim also returns a `refreshToken`, which the device trades at `POST /api/v1/auth/refresh` for a new bearer and a new
refresh token, before or after the bearer expires. The refresh token lasts 90 days from its last
use and is spent by each refresh. The one just replaced keeps working until the device uses the
new bearer or refresh token, so a device that lost the response (a timeout over a slow tunnel, or the
app suspended mid-request) refreshes with it again, however much later, and gets another pair. Once
the new bearer has been used, the replaced token is honoured once more within ten seconds, for a
retry already on its way, and presenting it after that ends the whole sign-in (403 `refresh_reused`),
because a copy exists. Once the new refresh token has been used, the replaced one is simply invalid
(403 `invalid_refresh`). Both tokens live on one session, so revoking the
device, signing out, a password change or removing the account ends them together. Removing an
account also removes the paired devices that act as it.

An app from 2.0 on names its installed version, `appVersion`, when it claims its code and each time
it refreshes. The tokens it gets then carry that version (base64url JSON
`{ "v": 1, "appVersion": "2.1.0", "token": "<random>" }`, `src/server/device-token.ts`), so every
request it makes names the app that sent it, and the device's `appVersion` in `/paired/devices` records
the last one it named. An app before 2.0 never names one and keeps getting a bare random token, so a
bearer with no payload is an app before 2.0. Tokens are still opaque to the device and only their
hashes are stored: the payload is not a secret, and changing it changes the token, which then matches
no session. An app that refreshes without naming a version gets bare tokens again, and its device
keeps the last version it named. A Watch and the app's Siri sign-in take the version of the app that
set them up and keep it through their own refreshes, which never name one. A version is X.Y (the
apps' marketing version) or X.Y.Z; one that can't be read is ignored, never refused, since a refused
refresh signs the app out. `appVersion` is optional while apps before 2.0 are served; it
becomes required once they are not.
The iPhone invites and claims its reachable Watch in one call (`POST /paired/invites?claim=true`),
without an administrator: the Watch makes no network call to join, the phone hands it its bearer,
refresh token and manifest, and the phone is recorded as its parent. The Watch acts as the phone's
account, appears as a separate device in System → Pair Device, and can be revoked there, by itself
or by its phone. Its scope is `app:rulesOnly`: its sessions may only read session,
connection, group, rule and change state, pause, resume, extend and allow any group, and pause,
resume, extend, allow, disallow, turn on and turn off any rule, or lift one for a single group; role never limits a control. They cannot
create, edit or delete rules. A phone may set up several Watches. Revoking or removing the phone
revokes its Watches too; signing the phone out does not. It renews its own bearer with its own
refresh token.

The app pairs as `app`, whether it runs on a phone, a tablet or a Mac.

### FamilyFi Me on a child's phone

FamilyFi Me pairs as `me` with `me:askOnly`. An administrator, in a browser or the app, invites it
like a phone, over a route for five minutes, but names the person it is for
(`{ clientType: "me", displayName, endpointId, personId }`, `personId` being the person's family
group id; 400 `family_group_required` for a group of things) instead of an account. Its code carries what a phone's does: the route, its pin, and a
Cloudflare Access token where the route has one, so it reaches the household away from home. It
signs in for that person and never as an account: its session's `kind` is `person` (not to be
confused with `personal`, an administrator's own account), its `personId` the person's family group
id, its `displayName` the person's name and its `username` names the device, and a paired-device
listing shows its `person` with `actsAs` null. It has no parent device, since it belongs to its group: re-pairing or
revoking the phone that invited it leaves it alone.

It reads its own group with `GET /groups/{id}` (any other group is 404 for it, except a [shared Thing](#shared-things)), the rules that cover it with `GET /rules`, and the time zone with `GET /auth/session`. `groupDayOf` (`src/lib/child-day.ts`) builds its day from them, which tells the group's own pause and allowance, the windows of its
internet rules (each with the days it starts on, its household-time start and end, and `allowed`
while its rule is lifted for the group until a time), and the rules that block something all the
time (with `allowed` too); nothing else in the household. A rule lifted with no end is left out. A `by` is `null` where FamilyFi recorded no person, or the recovery account acted.
`meDaySubject` tells an always-on internet rule as blocking all day, and an allowance through the
windows it marks `allowed`; it does not read `allowance` itself, or always-on category, app and
website rules, which an app lists on its own. An invite for a child's phone is cancelled while it
waits when the phone that made it is revoked, or its administrator is demoted or deleted. `src/lib/child-day.ts`
(`meDaySubject`, `tellDay`) turns that answer into the day FamilyFi Me shows. It renews like any
paired device, and may revoke itself. On an iPhone or iPad it tells its Screen Time permission,
which it needs to block apps, with `PATCH /paired/devices/{its id}` `{ "protection": "on" |
"notAllowed" | "removed" }` and nothing else (403 `own_device_required` for an administrator, and
any other device is refused by its scope or as no administrator); its record then shows `protection` and `protectionAt`, and Android's never
does. Deleting its group revokes it and cancels invites still
waiting for the group, keeping the record; an import keeps it where its group comes back with the
same id and revokes it otherwise.

#### Shared Things

A Things group's `kidsCanAsk`, which an administrator sets with `PUT /groups/{id}` (400
`invalid_request` on a family group), shares it with every child: one switch, the same for each.
A child's phone then reads it as it reads its own group: `GET /groups` lists its own group first,
then the shared Things; `GET /groups/{id}` answers for each; `GET /rules` holds the rules that
cover any of them, each showing only those groups. Each Thing's day comes from `groupDayOf` like
the child's own. On a Thing a child reads `ask` only when the ask is their own, and asks on it as
on their own group (below). A Thing not shared, like any other group, is 404 for the phone, and
turning the switch off hides it again at once.

#### Asking for more time

FamilyFi Me asks on its own group with `POST /groups/{id}/asks`: `{ "about": "pause" }` to be
unblocked (while the group is paused, or a Thing's Block button default blocks it), or `{ "about": "rule", "ruleId", "minutes" }` (5 to 240) for time in the window of one of
the group's rules that is blocking it now, or that starts within five minutes (asked from the heads-up's
countdown; a yes counts from the window's start). Only a child's phone asks (403 `child_only`), and only on
its own group or a shared Thing (404). On a Thing the ask's `from` names the child who asked, the
`ask.new` alert carries the Thing's name as `t` and opens the Thing, and refusals name the Thing. The ask shows as the group's `ask` (`GroupAsk`) on `GET /groups/{id}` and
`GET /groups` for a day, and phones with alerts on hear `ask.new`. A group has one waiting ask at a
time, whichever child filed it (409 `ask_waiting`); asking about something that is not blocking it now is 409 `not_blocked`,
and about an always-on rule 409 `always_on`; after a no that child waits the household's
`askWaitMinutes` before asking about that group again (409 `ask_too_soon`); more than six asks an
hour from one child about one group is 429 `too_many_asks`.

No route says yes: a parent answers with the verb that lifts what the ask is about, adding its
`askId`. An ask to unblock (`pause`) is answered by what the group card's Unblock button sends, as if the parent tapped it: `POST /groups/{id}/unblock`, or, while the Block button default alone blocks, that rule's `POST /groups/{id}/rules/{ruleId}/pause`, each for the time the parent picks on the card's own sheet. Those carry no `askId`: the ask is answered yes once nothing it is about blocks the group (`POST /groups/{id}/rules/internet/resume` with `askId` answers it by id while only a pause is behind it, and is 409 `still_blocked` while a Thing's Block button default blocks it too); `POST
/groups/{id}/rules/{ruleId}/allow` lifts the rule for the group for the minutes asked, from now, or
until the parent's own `until`, and never past the end of the window that is on (409 `not_in_window` once it is not). Only an administrator answers by `askId`, as only one declines (403 `administrator_required` for a Watch, the app's controls or an agent). The ask is taken
before the write, so a second parent answering it gets 409 `ask_closed`, and is put back if the
write fails. `POST /groups/{id}/asks/{askId}/decline` is Not now. Any other write that lifts what a
waiting ask is about (the group's unblock or allowance, the rule paused or allowed for the group or
for everyone) answers it yes as well, by that parent. An ask nobody answers closes at the earlier of
the household's `askTimeoutMinutes` and the end of the block it asks about (moved when the pause is set again or extended): `timedOut` or `ended`. It
reads closed as soon as that time passes, and the next sync pass writes it so. A yes to unblock ends (`ended`) at a parent's newer block or
unblock of the group (paused, resumed or unblocked again, or its Block button rule lifted or put
back), so a child's day tells only the newest.

An app's Siri, Shortcuts and system controls (Control Center, Quick Settings) run outside the app.
They never use the app's own tokens: two holders of one rotating refresh token end the sign-in
(403 `refresh_reused`). The app instead sets up a second sign-in for them with the same call
(`clientType: app-controls` and a `clientId` the app makes once and keeps), and stores the
answer where its native code reads it. That is its own paired device, `app:rulesOnly`, with the
Watch's list and the app as its parent, listed in System → Pair Device in its platform's words ("Siri and Shortcuts on" an
iPhone, "Quick Settings and shortcuts on" an Android phone). Setting it up again with the same `clientId` replaces the earlier record, so an app has
one. It works over remote access as a Watch does, and revoking or removing the app revokes it. Only
an `app:full` device administers, sets up a Watch or this sign-in, or is re-paired: the server asks
for the pair, never the client alone (`isFullApp` in `src/server/device-scope.ts`).

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
`clientType: agent`, an administrator may change their scope, and they are revoked like a phone, by an
administrator or by themselves. The
[authorization matrix](../tests/integration/authorization-matrix.test.ts) names, for each route,
which device scopes may call it.

### Client types and device scopes

Every invite and paired device holds two separate values ([`src/lib/client-type.ts`](../src/lib/client-type.ts)):
its **client type**, which says who is talking, and its **scope**, which says what it may call. The
invite sets both, the claim copies them onto the device, and every signed-in call reads them from the
session's device; no header carries them. The pairing code carries the client type too, so a client
can tell a code meant for another before spending it: the app spends only an app's code and FamilyFi
Me only its own, and a code with none (from before 2.0.0) is the app's (`verifyHousehold` in
`src/lib/companion-pairing.ts`).

| Client type | What it is | Scope |
| --- | --- | --- |
| `app` | The FamilyFi app on a phone, tablet or Mac | `app:full` |
| `app-watch` | That app's Watch | `app:rulesOnly` |
| `app-controls` | That app's Siri, Shortcuts and system controls, which run outside the app | `app:rulesOnly` |
| `me` | FamilyFi Me on a child's phone | `me:askOnly` |
| `agent` | An AI agent | `agent:full` or `agent:readOnly` |

`me-watch` is reserved. The scope is stored as one value, `group:scope`, and each is one explicit
allowlist in [`src/server/device-scope.ts`](../src/server/device-scope.ts), not a ladder:

| Scope | May call |
| --- | --- |
| `app:full` | Whatever its account may |
| `app:rulesOnly` | Its session, connection manifest, groups, rules and changes; the rule and group-rule verbs; revoking itself (403 `watch_scope` for a Watch, `app_scope` for the app's controls, beyond that) |
| `agent:full` | Household reads and controls; never accounts, UniFi settings, resolvers, household-settings changes or connection management |
| `agent:readOnly` | Household reads |
| `me:askOnly` | Its session, connection manifest, its own group and the shared Things and the rules that cover them (`GET /groups`, `GET /groups/{id}`, `GET /rules`); asking for more time on those (`POST /groups/{id}/asks`); revoking itself, and telling its own Screen Time permission (`PATCH /paired/devices/{its id}`) (403 `me_scope` beyond that) |

A client type holds only the scopes in its row, and a device holding any other allows nothing. A
phone, tablet or Mac always pairs as `app`, and a Watch and an app's Siri and shortcuts enroll with
`app:rulesOnly`; an administrator chooses an agent's scope when connecting it.

The API names them the same way everywhere: `clientType`, and `scope` as its whole value
(`agent:full`). API 2.0.0 removed the older words (`client` with `phone`, `app` or `watch`, and
scopes without their group) from requests and responses, and named a child's phone's sign-in for the
person it is for (session `kind: person` with `personId`, the invite's `personId`, a listed child's
phone's `person`), so `x-min-app`, `x-min-server` and `x-min-me` rose to 2.0.0 with it: an app
built before it is told to update.

The server signs endpoint manifests using its persisted Ed25519 instance key. A phone may
accept a pin change only in a manifest signed by the already trusted key; any other identity
or pin change requires a new administrator-generated pairing.

The signed-in **System → API** page (`/reference`) renders this OpenAPI file with Swagger UI. Try it out sends the session cookie and CSRF header. `GET /openapi` returns the YAML and requires a session: a browser cookie, or a phone's or agent's bearer.

CI holds the implementation to this document: `pnpm test-api` fails when a route or method is missing from it, and every response the integration tests receive must use a status documented for that route and, when JSON, match its schema.

## Versioning the contract

The companion app ([`familyfi-mobile`](https://github.com/nickberardi/familyfi-mobile)) vendors this repository as its `vendor/familyfi` submodule and generates its API types from `openapi/familyfi.v1.yaml` (`pnpm run schema`), so `info.version` names which contract revision a pin carries. Every pull request that changes the document raises `info.version` (unless the version on the base branch is still unreleased, below), and `package.json`'s version and `API_VERSION` in `src/lib/api-compat.ts` with it (`tests/unit/version.test.ts` and `tests/unit/api-compat.test.ts` keep the three equal). `scripts/ci/check-openapi-version.mjs` enforces the rule against the base branch:

| The pull request changes | `info.version` must |
| --- | --- |
| Nothing in the parsed document | Nothing to check |
| Only `description` or `summary` text | Increase; a patch is enough |
| Anything else: a path, parameter, schema, enum value or status | Increase by at least a minor version |
| Anything, with the `breaking_api` label | From 1.0.0 on, increase by a major version. Before 1.0.0 a minor increase carries the break, as semver allows for `0.y.z` |

A major increase needs the `breaking_api` label, which only the operator adds. While the base branch's version is above the latest release tag's, it has not shipped: a pull request may then keep it, and is held to the same table against the latest release instead, so the contract changes between two releases share one increase. A pull request may still raise it. The `OpenAPI` workflow's job summary names the old and new version as a reminder to re-pin `familyfi-mobile`'s `vendor/familyfi` submodule and regenerate its types; it posts nothing outside this repository.

Run the check locally with `make test-api-version`, or against any ref with `node scripts/ci/check-openapi-version.mjs <ref>`.

### Which apps and servers can read each other

An app and a server on different contract versions can each send something the other can't read: a response field an old app relies on goes away, or a new app reads a required field an old server never sends. Three lines under `info:` say how far each side reaches:

- **`x-min-app`**: the oldest client API version this server still serves. It rises to the new `info.version` whenever oasdiff's `breaking` check finds a change that breaks old clients, such as a response field removed or made optional. The `breaking_api` label approves such a change; the floor records which apps it leaves behind.
- **`x-min-server`**: the oldest server an app built from this document can read. It rises to the new `info.version` whenever `oasdiff changelog` reports `response-required-property-added` or `response-property-became-required`. A new endpoint does not raise it: an old server answers it with 404, which a client already reports as an error.
- **`x-min-app-watch`**: the oldest watch app API version this server still serves. The watches read only a few routes, so most breaking changes never reach them; until CI can tell which do, it is set by hand (0.30.0).
- **`x-min-me`**: the oldest FamilyFi Me API version this server still serves, set by hand like `x-min-app-watch` (it started at 2.0.0).

Any of them may rise on purpose and none ever falls or passes `info.version`. `scripts/ci/check-openapi-floors.mjs` (`make test-api-floors`) enforces the rule against the base branch, in CI's first job, `contract`, before the long jobs start. Their first values came from replaying the rule over the document's history: 0.34 and 0.36 broke old apps, and 0.36 added required response fields, so both started at 0.36.0; 2.0.0 removed the older client words and named FamilyFi Me's sign-in for a person, and raised both, and `x-min-me` by hand, to 2.0.0. `x-min-app-watch` started at 0.30.0, set by hand. `x-min-app` then went back to 1.4.0, once, on the operator's decision (familyfi#454): app 1.4 paired before a server's upgrade keeps reading the household, its Watch and its Siri sign-in, and the paired-devices list reads 1.4's `?client=` filter again. Setting up a new Watch, Siri or phone from 1.4 still needs the 2.0 app.

**Deprecated in 2.0, gone by 2.3.0.** Everything 2.0 keeps only for apps before it ends by 2.3.0, on the operator's decision: Health's `minAppApiVersion` and `minWatchApiVersion`, the paired-devices list's `?client=` filter, an optional `appVersion` at pairing and refresh (required from 2.3.0), and the 1.4.0 app floor (`x-min-app` at least 2.0.0 from 2.3.0, `info.x-min-app-by`). Every `deprecated: true` in the contract names its `x-removed-in`, every field that will become required its `x-required-in`, and `tests/unit/api-deprecations.test.ts` fails once `info.version` reaches either while the promise is unkept. Anything deprecated later in 2.x is marked for removal the same way.

`GET /api/v1/health` reports `apiVersion` (this document's `info.version`), `minAppApiVersion` (`x-min-app`) and `minWatchApiVersion` (`x-min-app-watch`) to anyone, in every answer. Those two are deprecated and will be removed in a future version; new clients name their type and read `minApiVersion` instead, and they stay only so apps built before 2.0.0 are still told to update. A client that names its client type, `GET /api/v1/health?clientType=me`, also gets `minApiVersion`, its own floor from the server's table (`MIN_API_VERSION_BY_CLIENT` in `src/lib/api-compat.ts`): `x-min-app` for `app` and `agent`, `x-min-app-watch` for `app-watch` and `app-controls`, `x-min-me` for `me`. A client type the server does not know, or a server before 2.0.0, sends none, and the client falls back to the two fields above. A client that can meet a server of another version, the companion app, compares them before it reads the household (`src/lib/api-compat.ts`, and the household store's `checkCompatibility`):

| Condition | The client shows |
| --- | --- |
| Its own API version < the server's `minApiVersion`, when it named its type, else `minAppApiVersion` (a watch: `minWatchApiVersion`) | Update the app |
| The server's `apiVersion` < its own `x-min-server` | Update the server |
| Otherwise | The household |

Pairing makes the same check after the household's identity verifies and before the code is spent (`verifyHousehold` in `src/lib/companion-pairing.ts`), and the native watch apps port it, replaying its cases in `tests/fixtures/display-vectors.json`. A watch reads only a few routes, so it asks `/health` only once one of them fails, compares its own version with `minWatchApiVersion` (`apiCompatibility`'s `watch` client), and asks for an update only for that true breakage. A health read that fails decides nothing. A server from before 0.41.0 sends no `apiVersion`; its `version` is the same number. The web skips the check, since its own server serves it. `tests/integration/min-app.test.ts` proves `x-min-app`: it runs `src/lib` from the commit that first carried that version against today's route handlers, and fails on any throw.

### Values that grow

A list the server is expected to extend, such as `CheckupCheck` or a paired device's `clientType` (`ClientType`), is declared with `x-extensible-enum` instead of `enum`, so adding a value is a minor version and not a breaking change. A client must accept a value it does not know. Where such a value is shown to the user, the object also carries a `Message`: a `key` (for example `checkup.leftover_policies`) that the client looks up in its own localized copy, and `text`, a short English line. A client with no copy for the key shows `text` and adds its own note that a newer app shows more. Clients keep their copy and localization; the server's `text` is only the fallback.
