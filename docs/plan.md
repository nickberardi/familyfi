---
todos:
  - id: review-designs
    status: pending
    content: 'Review Card System, Web Design, and Sign In; apply agreed behavior and accessibility precedence'
  - id: repository-scaffold
    status: pending
    content: 'Create the GitHub repository and scaffold Next.js, TypeScript, Prisma/PostgreSQL, authentication, ignore rules, and Actions'
  - id: docker-make
    status: pending
    content: 'Provide Make targets, GHCR distribution, and Compose with bundled or external PostgreSQL'
  - id: phase1-spike
    status: pending
    content: 'Prove official UniFi MAC internet block/restore on a live gateway, with automated or operator-assisted client verification'
  - id: phase2-backend
    status: pending
    content: 'Implement Family/Things, group protection, quarantine, schedule suspension, credentials, and serialized reconciliation with revision-specific results'
  - id: openapi-contract
    status: pending
    content: 'Document and contract-check every web/backend API in OpenAPI, including authentication suitable for future native clients'
  - id: phase3-ui
    status: pending
    content: 'Port available designs into responsive web/PWA flows using the agreed schedule and quarantine semantics'
  - id: phase4-verify
    status: pending
    content: 'Complete CI, API contract, integration, browser, container, and live enforcement verification'
  - id: public-release-readiness
    status: pending
    content: 'Choose open-source/commercial licensing and contribution terms before public release; verify clean distribution artifacts'
name: FamilyFi
overview: 'Build a single-household FamilyFi web/PWA backed by PostgreSQL and official UniFi enforcement. Family and Things share group-level controls; Pause suspends schedule enforcement and Resume restores it. Document the complete versioned API in OpenAPI for a future App Store app.'
isProject: false
---
# FamilyFi — the UniFi Family Internet Control Center

## Product and agreed scope

FamilyFi provides family internet controls on top of a UniFi gateway. One deployment serves one household. Application state is desired configuration; app-owned UniFi firewall policies enforce it. Never modify, disable, delete, or reorder administrator-created policies. All UniFi calls are server-side.

- **Family:** groups representing real people, with child, teen, or adult roles.
- **Things:** arbitrary device groups such as TV, Computer, and Smart home.
- Each assigned device belongs to exactly one Family or Things group. There is no third grouping type. If the design's “House” destination is retained, implement it as an ordinary Things group.
- Unassigned devices are consistently called **Quarantined devices** in the API, documentation, and tests. The Devices UI calls them **Unassigned**. Discover and block them through polling, initially about every 30 seconds. They may have internet before discovery and enforcement; immediate network admission control is not promised.
- Protection belongs to the group, whether Family or Things. Protected groups are exempt from FamilyFi blocking. Per-device protection is future work.
- **Pause suspends schedule enforcement and makes internet available from FamilyFi's perspective. Resume restores scheduled enforcement**, which may allow or block internet according to the current time. Pause is not a manual internet-block command.
- A timed Pause automatically resumes the schedule at expiry. Extend prolongs that suspension. An indefinite Pause lasts until Resume.
- The initial client is a responsive web/PWA. A native App Store app is planned later and must use the same documented backend API.
- Initial distribution is a Docker image published to GitHub Container Registry (GHCR). PostgreSQL is used in development, CI, and deployment.

“Internet available” describes the absence of a FamilyFi block, not a guarantee that ISP connectivity or administrator rules permit access. Group protection never overrides administrator policies.

## Context and UniFi references

Read the [UniFi onboarding guide](https://developer.ui.com/network/v10.4.57/ai-gettingstarted.md), [endpoint index](https://developer.ui.com/network/v10.4.57/llms.txt), and [OpenAPI contract](https://developer.ui.com/network/v10.4.57/openapi.json) for integration work. Use the official Network Integration API with `X-API-KEY`.

Support the cloud connector base `https://api.ui.com/v1/connector/consoles/{consoleId}/proxy/network/integration` and a local console integration base URL. Record the complete local URL format, console/Network versions, and connection modes verified in the spike. Do not assume a bare console hostname is already an integration base.

Family/Things grouping is application-owned. Do not create UniFi Object Manager groups. FamilyFi cannot issue or rotate UniFi keys: an operator creates a key in UniFi and pastes it into FamilyFi; revocation happens in UniFi.

## Design import (before coding UI)

Read the local files under `<root>/designs` before UI work:

- `Card System.dc.html` — component anatomy and density contract. Its prototype `kind: person|group` maps to Family/Things. Kind determines marks and wording; the surface determines comfortable, compact, or dense presentation. Read its drift audit, rules table, and specimens.
- `Web Design.dc.html` — reference for Family, Things, Schedules, Devices, Quarantined, Reconciliation, Settings, assignment, roles/admin management, and API-key replacement.
- `Sign In.dc.html` — authentication visual reference. Adapt prototype flows to the authentication scope below.

These are the currently available design documents. Use Card System's phone specimens and responsive adaptation of Web Design for mobile. Do not depend on absent App Design, Phone, Family Controls, or Web Admin documents. Supporting files include `support.js`, `ios-frame.jsx`, uploaded assets, and the design-system bundle.

References contain markup, literal styles, embedded CSS/classes, and, where present, a `class Component extends DCLogic` prototype. Read the applicable markup, styles, and logic. Derive reusable implementation tokens from the references.

Precedence when references disagree:

1. Agreed behavior and API/security requirements in this plan govern production behavior. Replace prototype “Pause blocks internet” logic and misleading success messages.
2. Accessibility requirements override conflicting literals: text contrast at least 4.5:1 and no text under 14px rendered below 0.7 alpha. Audit and correct reference values; do not assume the prototypes already comply.
3. Card System governs shared anatomy, marks, and density; Web Design and Sign In supply their respective layouts and interactions where consistent with the above.

Prototype credentials, timestamps, device counts, key-format assumptions, gateway facts, and instant success toasts are examples, not production facts. Protected groups must not expose controls that bypass their protection.

The current `/designs/` directory is private implementation reference material. Exclude it from Git and Docker build contexts from the first commit. Public source/builds must not import from it. Place deliberately selected distributable assets in `public/` only with appropriate rights; never copy the reference directory wholesale.

## Stack and source structure

One Next.js App Router + TypeScript application serves the web/PWA and backend:

- **UI:** React and Tailwind, with tokens derived from the references.
- **API:** Route Handlers under `/api/v1`; server modules hold business logic shared by routes and reconciliation. No browser-side UniFi calls or credentials.
- **DB:** Prisma/PostgreSQL everywhere, with one provider and migration history. SQLite is not part of this version.
- **Secrets:** encrypt the UniFi key in PostgreSQL using environment-provided `APP_ENCRYPTION_KEY`. Personal passwords use Argon2id or bcrypt. Environment configuration holds database credentials, `DEFAULT_PASSWORD`, and session/encryption secrets, not the normal runtime UniFi key.
- **Jobs:** reliably initialized reconciliation on startup, about every 30 seconds, and after desired-state changes. Initial deployment is one long-running application container, without a serverless scheduling assumption.
- **Developer interface:** root Makefile commands mirror GitHub Actions. Actions performs authoritative builds, linting, validation, tests, and release publication; local commands remain available for development/diagnosis.

Use a conventional, compact structure:

```text
.github/          # workflows, issue/PR templates, dependency updates
src/
  app/            # Next.js pages/layouts and api/v1 route handlers
  components/     # shared UI
  server/         # auth, database, UniFi, domain logic, reconciliation
  lib/            # genuinely shared client-safe utilities/types
prisma/           # PostgreSQL schema and committed migrations
openapi/          # versioned API specification
tests/            # unit/integration/contract/browser tests and sanitized fixtures
scripts/          # spike, verification, operational scripts
docker/           # Dockerfile and Compose files (build context remains repo root)
docs/             # architecture, setup, operations, API use, spike results
public/           # distributable application assets only
```

Keep standard root entry points/configuration: README, Makefile, package manifests/lockfile, framework/tool configuration, `.gitignore`, `.dockerignore`, and `.env.example`. Dockerfile and Compose files live under `docker/`. During scaffolding, place planning and extended documentation under `docs/`. Avoid a monorepo, separate mobile backend, unnecessary abstractions, and miscellaneous generated root files.

## New GitHub repository and licensing

Create a new GitHub repository during execution; none is assumed to exist. GitHub repositories, Actions, Containers, Releases, Issues, branch protection, and wikis are available to use where useful. Keep the repository private until explicit public-release/licensing decisions are settled.

- Configure Actions for linting, type checking, tests with PostgreSQL, OpenAPI validation/implementation contract checks, browser tests, production builds, and container smoke tests.
- Publish versioned application images to GHCR and release notes to GitHub Releases. Document tags and supported image architectures; test the architectures advertised.
- Add useful issue/PR templates, dependency updates, required PR checks, and default-branch protection. Scope CI credentials to jobs that need them.
- Keep authoritative documentation in version-controlled `docs/`. Use the wiki for supplementary guides where helpful, without conflicting copies.
- Include README, contribution guidance, and a security-reporting policy before public release.
- `.gitignore` must exclude `/designs/`, `.env` and local secret files, dependencies, build output, local database data/backups, logs, coverage, browser-test artifacts, and machine-specific temporary files. Retain `.env.example`, the package lockfile, migrations, OpenAPI source, and sanitized fixtures.
- `.dockerignore` also excludes design references, secrets, local data, Git metadata, and unnecessary development artifacts. Verify neither the first commit nor release artifacts contain private references or real credentials.

The intended licensing model is an open-source license plus an alternative paid commercial license. The exact open-source license, commercial terms, copyright ownership, and terms for outside contributions remain decisions before public release. Contribution terms must support offering contributed code under the intended commercial terms; do not silently choose a license or assume an ordinary contribution sign-off provides those rights.

Commercial licensing offers alternative rights; it does not mean every commercial user must pay while complying with the open-source license. See the [GNU explanation of commercial exceptions](https://www.gnu.org/philosophy/selling-exceptions.en.html) and [Open Source Definition](https://opensource.org/osd). Include the selected license files and explanation before publication.

## Makefile, Docker, and PostgreSQL

Phone and desktop browsers share the application container; a future native client uses the same API.

Create at scaffold time:

- `Makefile` — setup, development, verification, spike, and container commands.
- `docker/Dockerfile` — multi-stage dependency installation, Prisma generation, Next.js build, and production runtime. Image builds use repository root as context (`docker build -f docker/Dockerfile .`); `.dockerignore` stays at the repo root for that reason.
- `docker/docker-compose.yml` — application using a released GHCR image and common configuration.
- A bundled-PostgreSQL Compose override, selected by the default Make run path, with health check and persistent named volume. External database mode must not start that service.
- An explicit development build/Compose path for locally built images.
- `scripts/docker-entrypoint.sh` — validate settings, wait for database readiness with bounded retries, run `prisma migrate deploy`, and start the application. Do not run development migrations on deployed startup. Local `scripts/with-env.mjs` does the same `migrate deploy` (plus `prisma generate`) before Next so a long-running `make dev` process cannot serve an old generated client against a new schema.
- `.env.example`, `.gitignore`, and root `.dockerignore`.

Expose `DB_MODE=bundled|external`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and documented SSL settings such as `DB_SSL_MODE` and CA configuration where required. Safely derive Prisma's `DATABASE_URL` from these settings, including URL-encoding credentials, avoiding competing sources of truth. Users must not need to edit Compose YAML to select an external server. Bundled mode uses its service hostname and configured database/user/password; external mode uses the supplied host and has no dependency on a bundled-service health check.

The application listens on container port 3000; publish `7001:3000` by default. Container URL: `http://localhost:7001`. Local `make dev` may use port 3000. Document the LAN hostname/address for phones and HTTPS setup for deployed authentication/PWA use. The bundled database need not publish a host port for container operation; provide an explicit development database path for running Next.js outside Docker.

| Target | Behavior |
| --- | --- |
| `make setup` | Install with pnpm; create `.env` only if missing; prepare the chosen development database and apply migrations |
| `make dev` | Local Next.js with hot reload; applies `prisma migrate deploy` and regenerates the client before Next listens |
| `make test` | Unit/integration tests against an isolated test database |
| `make test-api` | OpenAPI validation and API contract checks |
| `make spike` | UniFi integration spike CLI |
| `make lint` | ESLint |
| `make typecheck` | TypeScript checks |
| `make build` | Production Next.js build |
| `make docker-build` | Explicitly build a local application image |
| `make docker-dev-up` | Start the locally built image with the selected database mode |
| `make docker-up` | Pull/start the configured GHCR image; default to bundled PostgreSQL |
| `make docker-down` | Stop the selected Compose stack without deleting database volumes |
| `make docker-logs` | Follow container logs |

Release-container run path:

```bash
cp .env.example .env
# Set DEFAULT_PASSWORD, SESSION_SECRET, APP_ENCRYPTION_KEY, and DB credentials.
# Default DB_MODE=bundled; for an existing server set DB_MODE=external and its settings.
make docker-up
# Open http://localhost:7001, sign in as admin, and configure UniFi in Settings.
make docker-logs
make docker-down
```

Before the first GHCR release, use `make docker-dev-up`. Never overwrite an existing `.env`, bake secrets into images, or delete volumes during ordinary shutdown. Document database backup/restore together with preservation of `APP_ENCRYPTION_KEY`, which is needed to recover encrypted UniFi credentials.

## Authentication and credentials

- Reserve username `admin` for a permanent setup/recovery account authenticated using operator-configured `DEFAULT_PASSWORD`. It remains available after personal accounts are created and cannot be removed/disabled through household administration.
- Require an operator-supplied value rather than shipping a universal password. The environment value is authoritative for this recovery credential; document how changing it takes effect. Never expose it in the API or logs.
- Adults granted admin access receive individual usernames/passwords. Their accounts replace everyday use of recovery `admin`, not its availability. Children/teens do not log in; Things cannot have accounts. Prevent personal usernames from colliding with `admin`.
- Keep adult/admin authorization separate from group protection. Protection is an explicit group setting, not an implicit consequence of login privileges.
- Provide personal-account creation/revocation and password setting/reset by an authenticated administrator, including recovery through `admin`. Revoke affected sessions when access is removed or passwords change.
- Initially use password login and administrator-assisted recovery. Defer prototype email sign-in/reset links and remove promises of unimplemented email/lockout behavior. Implement and document actual login throttling and session expiry.
- Support secure browser sessions with CSRF protection for cookie-authenticated mutations and a revocable bearer-session path suitable for future native clients. Document issuance, expiry, logout, and authorization in OpenAPI. The App Store client itself is future work; native-compatible API authentication is initial scope.
- Store the UniFi key encrypted in PostgreSQL. No competing runtime `UNIFI_API_KEY` environment setting. Validate replacements before saving; failure preserves prior credentials. Return only masked credential status.
- For console/site changes, validate the new target and serialize the transition against reconciliation. Clean up recorded app policies on the old target before completing the switch. If cleanup cannot be confirmed, retain old connection/ownership records and report the blocked transition instead of abandoning active rules.

## Data model and schedule semantics

Desired configuration lives in PostgreSQL; UniFi is enforcement only.

- **Household:** UniFi connection identity (base URL or console ID, site ID), IANA timezone (gateway setting in Settings; stored on the household row), encrypted key, configuration revision, and connection status.
- **Group:** `kind: family|things`, name/identity presentation, Family role where applicable, `protected`, schedule `{enabled, days[], start, end}`, and suspension `{active, until?}`. Both kinds share control semantics.
- **Account/Session:** recovery and personal adult identities, credentials as applicable, permissions, expiry/revocation, and personal-account relationship to a Family group. Never return credential hashes.
- **Device:** canonical lowercase unique MAC, nullable `groupId`, assignment state `assigned|quarantined`, last hostname/IP/networkId/zoneId, and last-seen time. Null group means quarantined; enforce consistency with assignment state. Offline devices retain assignments and last known mapping.
- **AppPolicy:** connection/site identity, UniFi ID, owner scope (group or quarantine), group ID where applicable, zone/IP version, desired payload fingerprint/revision, observed settings/state, and last error.
- **PolicyOperation:** durable operation identity and create/update/delete intent for recovering interrupted writes without claiming foreign rules.
- **SyncRun/ChangeResult:** run/change identity, requested/applied revisions, timestamps, per-scope/device outcomes, and pending/applied/partial/failed/superseded status with errors.

For assigned devices:

```text
suspended = suspension.active && (until is null || now < until)
blocked = !group.protected
          && schedule.enabled
          && !suspended
          && inRecurringWindow(now, schedule, household.timezone)
```

Quarantined devices are desired-blocked independently of group schedules. Assignment removes quarantine enforcement and applies the destination group's state. Reassignment updates both old and new policy membership, including moves to protected groups. Deleting a group returns its devices to quarantine; make that consequence explicit in the UI/API.

The `blocked` formula is for UI/API desired state. UniFi enforces bedtime with the policy `schedule`; FamilyFi does not flip `enabled` at window start/end.

- **Pause:** set group suspension and PUT app-owned policies `enabled: false`. Preserve the UniFi `schedule`. Internet is available from FamilyFi's perspective.
- **Resume:** clear suspension and PUT `enabled: true`. The UniFi schedule remains; during bedtime this can block internet; outside bedtime it leaves access available. Do not enable a schedule explicitly disabled in its editor (those policies should have `schedule: null` and no block).
- **Extend:** prolong an active suspension (`enabled` stays false). For a duration extension, add to the later of the existing finite expiry and now, never shortening it. An indefinite suspension already has no expiry. The only clock-driven UniFi write for schedules is PUT `enabled: true` when a finite `until` is reached (reconciliation interval, not a separate cron).
- **Schedule enabled:** determines whether a recurring UniFi schedule is configured. Suspension is a separate temporary override via `enabled`. A group without an enabled schedule is unblocked and needs no Pause action.
- **Protected:** overrides group schedule blocking. Reject actions that bypass protection; present controls consistently as unavailable. Protection does not transfer with a device reassigned elsewhere. Protected groups have no FamilyFi block policies.

Days identify the local day a window starts: Monday 21:30–06:45 continues into Tuesday morning. Use an IANA household timezone, half-open windows (start inclusive/end exclusive), and absolute suspension-expiry timestamps. Reject equal start/end times and enabled schedules with no selected days. Evaluate windows in local wall time across DST: skipped local times do not occur and repeated local times are evaluated both times. Document/test overnight, week-boundary, expiry, and DST behavior.

Show schedule activity, access, and synchronization separately: “Schedule paused until 8:00 PM · Internet available,” “Bedtime active · Internet blocked,” and “Change pending.” Do not reuse old “Pause means off” copy or claim “back online” unconditionally after Resume.

## UniFi enforcement contract

Use documented v1 paths relative to the selected integration base:

| Need | Endpoint |
| --- | --- |
| Sites | `GET /v1/sites` |
| Networks | `GET /v1/sites/{siteId}/networks`, plus documented detail/reference reads as needed |
| Zones | `GET /v1/sites/{siteId}/firewall/zones` |
| Clients | `GET /v1/sites/{siteId}/clients`, paginated; documented MAC filtering where used |
| Policies | `GET/POST /v1/sites/{siteId}/firewall/policies` |
| Ordering snapshot | `GET /v1/sites/{siteId}/firewall/policies/ordering` |
| Update/toggle | `GET /v1/sites/{siteId}/firewall/policies/{id}`, then `PUT` the complete documented update payload |
| Delete | `DELETE /v1/sites/{siteId}/firewall/policies/{id}` |

- In the referenced schema, PATCH accepts only `loggingEnabled`; use PUT for `enabled` (UniFi policy Pause). Build the complete update request, preserving required settings, rather than blindly echoing read-only GET fields.
- Persist recurring bedtime on the policy `schedule` (`EVERY_WEEK` / `EVERY_DAY`; `null` if the group has no enabled schedule). Do not toggle `enabled` at bedtime edges. Pause/Resume is `enabled: false` / `true`. Timed Pause/Extend is `enabled: false` until expiry, then `enabled: true`.
- Never call the ordering PUT endpoint. `GET` ordering on Network 10.6 requires `sourceFirewallZoneId`. Preserve pre-existing administrator policies' configuration and relative order when adding/removing app policies.
- Standardize UniFi policy names on a `FamilyFi ` prefix with descriptive titles (for example `FamilyFi Betsy's Internet Access`, `FamilyFi Quarantine Internal Devices`). Establish ownership using recorded IDs and durable creation evidence, never a prefix alone. Never mutate rules the application cannot establish it created.
- Do not use client BLOCK actions, undocumented v2 calls, or LAN ACL blocks as substitute enforcement.
- Live action is firewall `BLOCK` (not `REJECT`, not client BLOCK). Match source zone plus the documented `MAC_ADDRESS` traffic filter with explicit membership; target External/WAN to preserve LAN access.
- Prove `IPV4_AND_IPV6` or separate policies per IP version as needed. Never claim full protection when an enabled IP version fails or remains unverified.
- Client-to-network mapping is a spike deliverable; do not assume client details contain `networkId`. Use documented network data and zone `networkIds` for network-to-zone mapping and record the exact supported client mapping.
- One source zone per policy: reconcile per `(group, source zone[, ipVersion])`, with separate quarantine policies per zone/IP scope. Prove multiple-MAC membership; document any required policy splitting before backend enforcement work.

## Phase 0 — Repository and scaffold

Create the repository, ignore rules, source structure, PostgreSQL/container/Make paths, authentication/bootstrap, and initial Actions. Start OpenAPI with the first route. Review local designs without committing them.

General scaffolding, contract drafting, and independent UI work may proceed while arranging the spike; enforcement-dependent backend work requires its live gate. This plan update does not start implementation. Begin execution on the user's implementation instruction.

## Phase 1 — Integration spike and live gate

Build a CLI in `scripts/spike/` plus a mocked UniFi client. The spike may accept a temporary `UNIFI_API_KEY` before application setup; this is CLI-only, not another runtime credential store. Never commit real keys or unsanitized household responses.

Against a real gateway and explicitly selected test devices:

1. List sites/networks/zones/clients/policies and record versions/connection mode.
2. Snapshot pre-existing policies and relative ordering; map test clients to source zones.
3. Record baseline internet and LAN access from the affected clients.
4. Create recorded `FamilyFi ` policies matching only test MACs to External. Verify internet loss for new and already-established traffic, while LAN and unrelated clients retain access.
5. PUT the complete payload with `enabled: false`; verify restoration.
6. Test multiple MACs, IPv4/IPv6 where available, and coexistence with administrator rules without reordering. Record limitations and untested cases.
7. Remove spike-created policies, including cleanup after failures. Verify administrator configuration/relative order remains unchanged. Preserve recovery information if cleanup fails.

Use an automated probe on the affected client or an operator-assisted checklist. An agent can orchestrate API calls/snapshots, but API success or a server-side probe does not establish what happened on a different client. Supply clear manual verification steps when client automation is unavailable.

**Exit:** sanitized fixtures in `tests/fixtures/unifi/` and `docs/spike/RESULTS.md` with exact working payloads, mapping, versions, traffic observations, snapshots, verification method, and cleanup result. Live success is mandatory before enforcement-dependent Phase 2 work; mocks do not satisfy it. If a gateway, credentials, or client verification is unavailable, report that prerequisite and continue only independent work. If official MAC enforcement or required coexistence fails, stop that work and report; do not substitute APIs or weaken the promise.

If IPv6 cannot be tested, record the limitation rather than claiming dual-stack verification. A deployment with active IPv6 requires live IPv6 success before claiming complete internet blocking.

## Phase 2 — Backend and reconciliation

Build a server-only UniFi client with documented pagination (limit at most 200), timeouts, error mapping, and proven complete payloads.

Serialize startup, interval, parent-action, and retry runs. Use a database-backed lock or equivalent ownership mechanism to prevent overlapping writers, including container replacement. Coalesce queued work toward the latest revision without marking superseded actions as successfully applied.

1. Read desired revision, groups, assignments, and connection identity.
2. Refresh clients and relevant network/zone data **on household-managed UniFi networks only** (`manageAllNetworks` or `managedNetworkIds`). Do not ingest or quarantine MACs first seen on other VLANs. Preserve offline assignments and last-known valid mappings; persist newly discovered in-scope devices as quarantined.
3. Derive UniFi payloads from protection, quarantine membership, group schedule, and suspension. Track unresolved devices explicitly. Failed/incomplete discovery or unresolved zones are not empty assignment sets. Do not recompute bedtime edges into `enabled`.
4. Reconcile complete MAC membership, policy `schedule`, and `enabled` (Pause vs running). Clock-driven work is only: expire finite Pause/Extend (`enabled: true`), plus discovery/membership. Handle both sides of reassignment, quarantine release, zone changes, and protection changes. Never report assignment success while stale policies still block that MAC.
5. Disable/remove obsolete policies only with proven ownership and a complete desired-state view. Group deletion transitions devices to quarantine.
6. Read back relevant policy membership/settings and enabled state. Record per-scope outcomes against the revision. One successful zone is not whole-group success.
7. Retry transient errors with backoff while retaining desired state. Recover durable write intents before issuing duplicate creates. If creation may have succeeded but ownership cannot be established, report an actionable unresolved operation; never adopt arbitrary prefix-matching policies.

Mutations return a change identifier and desired revision. Clients poll that change; global “last sync succeeded” does not confirm their action. Distinguish API submission, observed policy configuration, and traffic behavior established by the spike. Readback alone is not an end-to-end connectivity probe.

## Application API and OpenAPI

All web/backend communication uses `/api/v1`. Maintain `openapi/familyfi.v1.yaml` covering every endpoint, including auth, errors, settings, and asynchronous changes. Do not expose necessary business operations exclusively through framework-specific server actions; future native clients need the same API.

Include operation IDs, descriptions, parameter/request/response schemas, examples, required/nullable fields, enums, validation, pagination where applicable, security schemes, authorization, error/status codes, and change/revision semantics. Document cookies/CSRF and native bearer sessions, issuance, expiry, and revocation. Reuse schemas and generate client types where practical.

Initial inventory (specify each concrete route individually):

| Area | Routes/purpose |
| --- | --- |
| Auth | `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/session`; browser/native issuance and session state |
| Accounts | `GET/POST /api/v1/accounts`, `PUT/DELETE /api/v1/accounts/{id}`, `PUT /api/v1/accounts/{id}/password`; personal adult administration, with recovery-admin restrictions |
| Groups | `GET/POST /api/v1/groups`, `GET/PUT/DELETE /api/v1/groups/{id}`; Family/Things, roles, identity, protection, counts, desired/observed state |
| Schedules | `PUT /api/v1/groups/{id}/schedule`, `POST /api/v1/groups/{id}/pause`, `POST /api/v1/groups/{id}/resume`, `POST /api/v1/groups/{id}/extend` |
| Devices | `GET /api/v1/devices`, `GET /api/v1/devices/{mac}`, `PUT /api/v1/devices/{mac}/assignment`; assigned/quarantined filters independent of connected/offline state |
| Sync | `GET /api/v1/sync`, `POST /api/v1/sync/retry`, `GET /api/v1/changes/{id}`; app-owned policy counts, change log, Reconcile now |
| Settings | `GET/PUT /api/v1/settings/household`, `GET/PUT /api/v1/settings/unifi`, `POST /api/v1/settings/unifi/test` (omit `apiKey` to probe the stored key); timezone lives with Gateway in the UI; masked connection, family roles, adult logins |
| Health | `GET /api/v1/health`; minimal non-secret deployment health/readiness |

Document assignment removal as a transition to quarantine. Normal payloads never expose credentials, raw firewall JSON, or rule editors; troubleshooting uses safe summaries and affected group/device details.

Actions validates the specification and runs implementation contract checks against an isolated PostgreSQL-backed application, detecting undocumented routes and request/response drift. Every API change updates OpenAPI and relevant checks in the same change. Publish reference documentation from this specification. API documentation is part of completion, not deferred work.

## Phase 3 — Responsive web/PWA

Port available designs with the precedence above. Provide Family/Things lists/details, schedules and Pause/Resume/Extend, group protection, assignment/reassignment, Devices (including unassigned + quarantine override), troubleshooting/retry, household/admin management, sign-in, and UniFi setup/key replacement.

- Share Family/Things control semantics and component anatomy. No per-device protection UI.
- Show schedule suspension and internet state separately. During bedtime, Pause requests access and Resume restores blocking; outside bedtime Resume can leave access available.
- Quarantine is a desired block with separate enforcement status. Newly discovered devices are not shown as successfully blocked before readback.
- Track each mutation's change/revision until applied, partial, failed, or superseded. Surface coverage gaps and actionable errors, never unrelated-sync success.
- Desktop follows Web Design; phone follows Card System mobile/density specimens and responsive adaptation. Adapt sign-in to permanent recovery-admin and personal password accounts.
- Normal flows never show policy JSON, zone IDs, or UniFi rule editors.

## Outage behavior and operations

Accept that UniFi enforces recurring bedtime via policy `schedule` while FamilyFi is down. Pause stays off until FamilyFi PUTs `enabled: true` (indefinite Pause is fine; a timed Pause/Extend can outlast its expiry if FamilyFi is stopped). Quarantine/membership can lag until the next successful reconciliation. Startup reconciliation applies current desired state; it does not replay missed transitions.

Document this limitation and show stale synchronization where appropriate. Operations documentation covers recovery admin, encrypted-key/database backup and restore, external PostgreSQL/TLS, upgrades/migrations, and recovery from unresolved app policies. Do not promise restoration from desired state alone during outages.

## Phase 4 — Verification and release readiness

Actions performs authoritative validation; Make targets provide corresponding local commands. Live verification uses a manually triggered, appropriately connected runner/client probe or operator checklist. Ordinary hosted CI is not assumed to reach household devices. Never expose live credentials to untrusted PR jobs.

- **Unit:** MAC normalization, mapping, complete payloads, ownership guards, overnight/DST windows, suspension/resumption/extension, and protection precedence.
- **Integration:** real PostgreSQL with mocked UniFi; quarantine/assignment/reassignment, protection, deletion, offline/unresolved devices, expiry/startup recovery, backoff, overlapping triggers, superseded revisions, partial multi-zone errors, interrupted creates, and foreign-policy/relative-order preservation.
- **Auth:** permanent recovery access, personal account lifecycle, password/session revocation, role restrictions, cookie/CSRF and bearer paths, and secret redaction.
- **API:** all routes/schemas, success/errors, authorization, pagination, and action polling checked against OpenAPI.
- **Containers:** fresh install, migrations/upgrades, restart persistence, bundled/external PostgreSQL, special characters in credentials, port mapping, builds without `designs/`, and documented backup recovery.
- **Browser:** desktop/phone setup, sign-in, Family/Things, protection, schedules, assignment/quarantine, settings, troubleshooting, and accessibility.
- **Live:** record IPv4/IPv6 coverage, new/established traffic behavior, preserved LAN/unrelated clients, unchanged administrator configuration/relative order, and cleanup.
- **Release:** usable GHCR images/docs; private references and secrets absent from Git/images; licensing and contribution decisions completed before public release.

## Per-phase review

Each phase (scaffold, spike, backend/API, UI, verification) ends with `/code-review` on that phase's diff only. If unavailable, perform and record an equivalent scoped review.

Prioritize wrong contracts, foreign-policy mutations, auth/secret leaks, broken schedules/quarantine, false confirmations, meaningful missing tests, and data loss. Fix important findings; skip style nits/speculative refactors. Keep code conventional and tight, without unused helpers or comments restating the implementation. Do not mark phases complete without actual exit evidence; mocks and placeholder licenses do not satisfy live/public-release gates.

## Definition of done

A parent can deploy the GHCR image with bundled or external PostgreSQL, sign in with permanent recovery `admin` or an authorized personal adult account, configure UniFi in Settings, manage Family/Things and group protection, assign quarantined devices, set schedules, and Pause/Resume/Extend enforcement with action-specific confirmation or clear partial/failure states. Administrator policies remain untouched and outage limits are documented accurately.

Every web/backend API, including auth, is documented and contract-checked in OpenAPI for the future App Store client. CI, reproducible containers, conventional repository hygiene, setup/operations documentation, and recorded live verification are complete. Public release additionally requires selected open-source/commercial license files and compatible contribution terms. The native client remains future work.
