# Architecture

One Next.js App Router application serves the UI and `/api/v1`. All UniFi calls are server-side.

```text
src/app          pages, layouts, api/v1 route handlers
src/components   shared UI
src/server       env, database, auth, schedule, UniFi, reconciliation
src/lib          client-safe constants, types, and pure logic (schedule windows)
prisma           PostgreSQL schema and migrations
openapi          versioned HTTP contract
docker           Dockerfile and Compose files
```

Desired household configuration lives in PostgreSQL. UniFi firewall policies are enforcement only. The application never modifies, disables, deletes, or reorders administrator-created policies, and never calls the policy ordering PUT endpoint.

## Desired internet block

For an assigned device:

```text
suspended = suspension.active && (until is null || now < until)
blocked = !group.protected
          && schedule.enabled
          && !suspended
          && inRecurringWindow(now, schedule, household.timezone)
```

Pause suspends schedule enforcement. Resume clears the suspension and evaluates the stored schedule, which may still allow internet outside bedtime. Quarantined devices (null `groupId`) are desired-blocked independently of schedules.

That formula is UI/API desired state. UniFi enforcement: persist `schedule` on app-owned policies for recurring bedtime; Pause/Resume is PUT `enabled`; the only clock-driven `enabled` write is Extend/timed-Pause expiry. Membership, quarantine, and protection still go through reconciliation.

Discovery and quarantine only include clients whose UniFi **network (VLAN)** is in the household allowlist (`manageAllNetworks` or `managedNetworkIds`). New devices on other VLANs are not ingested and are not added to quarantine policies. Assigned devices that roam off a managed network are left out of FamilyFi policies until they return. UniFi still applies a MAC policy to every VLAN that shares that **firewall zone**; pick networks whose zones match what you want to enforce.

Days identify the local weekday a window starts. Windows are half-open. Evaluation uses the household IANA timezone and local wall time, including both occurrences of a repeated DST time. UniFi uses the console clock for native schedules; household timezone vs console timezone must be aligned or documented.

## Reconciliation

A database-backed lock serializes startup, interval (~30s), and mutation-triggered runs. Overlapping writers, including container replacement, must not apply stale revisions. Interval work is discovery, membership, and Extend expiry — not bedtime start/end. Until a UniFi key is saved in Settings, reconciliation is a no-op.

If a create may have succeeded but ownership cannot be proven, the app reports an unresolved operation instead of adopting arbitrary `FamilyFi ` prefix matches. Do not delete administrator rules to recover.

## UniFi client

`src/server/unifi` talks to the official Network Integration API (contract v10.4.57; live Network 10.6.106) with `X-API-KEY`. Pagination uses limit 200. Internet-block policies use firewall action `BLOCK` (live check: more effective than `REJECT` on this gateway). Policy enable/disable is PUT of the full write body. PATCH is logging-only. The client refuses PUT on policy ordering. `GET` ordering on this console requires `sourceFirewallZoneId`.

Integration bases:

- Local: `https://<console-ip>/proxy/network/integration` then `/v1/...`. A bare hostname is not an integration base.
- Cloud: `https://api.ui.com/v1/connector/consoles/{consoleId}/proxy/network/integration` (not live-tested).

Official client overview/details do not include `networkId`. Mapping:

1. `GET /v1/sites/{siteId}/networks/{networkId}/references` `CLIENT` `referenceId`s
2. Else match `client.ipAddress` to gateway network `ipv4Configuration.hostIpAddress` + `prefixLength` (and `additionalHostIpSubnets`)
3. Zone via `network.zoneId` and/or `zone.networkIds`

Destination zone: first of External, WAN, Internet (case-insensitive). Source: one policy per source zone. IP scope: `IPV4_AND_IPV6` with no protocol filter. IPv6 blocking, overnight UniFi scheduler windows, and a second concurrent MAC are unproven; do not claim dual-stack blocking.

### Curated category slots

`src/server/unifi/curated-categories.ts` maps five parent-facing slots onto confirmed
integer DPI category ids: Video (4), Social (24), Gaming (8), VPN (11) and Messaging (0).
`src/lib/rules.ts` mirrors that table for the browser and a unit test asserts the two
cannot drift. Only ids go into a policy body; `catalogName` is the console's own name for
that id and exists for docs and UI. Adult is deliberately not a slot, though the full
catalog still lists it for an arbitrary id pick.

Video, Social and Gaming were read off a household console. VPN and Messaging were added
against a catalog dump of Network 10.6.106 whose ids 4 / 8 / 22 / 24 / 28 reproduce the
already-confirmed map and the fixture's names exactly; that agreement on known ids is
what promotes the two new ones. Messaging is category 0 alone — the catalog also carries
15 "Web instant messengers", but it holds three obscure regional clients and a slot maps
to one id.

**Messaging's id is zero, so nothing on this path may test a target id for truthiness.**
Rule validation is `nonnegative`, not `positive`, and `normalizeTargetIds` filters on
`>= 0`. Both were `> 0` and silently turned a Messaging rule into an empty target list.
An integration test walks the id from the API through to the policy body.

Every curated slot also has a domain list of the same slug behind it in
`src/lib/upstream-domains.ts`, which is what lets its mark report a DNS verdict when no
policy is blocking; a unit test holds that pairing.

Mocks and fixtures do not prove enforcement. `UNIFI_MOCK=1` routes Settings and reconciliation through `MockUnifiClient` plus a dummy household seed so the UI can be exercised without a console; it is ignored in production. The spike CLI (`scripts/spike`) is for live gateway experiments; see [spike/OPERATOR.md](spike/OPERATOR.md).

## Upstream DNS categories

A second, independent signal: domain-list categories resolved through the household's
own DoH endpoint to report whether something already blocks them. **Reporting only.**
Nothing here creates, changes or deletes a UniFi policy, so these routes return no
`change` object and never enqueue reconciliation. UniFi remains the sole enforcement
path.

A verdict has four values and the fourth carries the weight. Every canary blocked is
`blocked`, some is `partial`, none is `open`, and any domain we could not resolve makes
the category `unknown` regardless of the rest. A failed query is a failure to observe,
not an observation: reporting `open` off a failed sweep would tell a parent nothing is
filtered when the truth is that we do not know, and reporting `blocked` would be a false
assurance. No configured endpoint, an unreachable one and an empty list are all
`unknown` for the same reason.

`src/lib/upstream-domains.ts` is a **seed, not runtime data**. The probe reads the
database. `ensureUpstreamCategories()` runs at every boot beside
`ensureRecoveryAccount()` — the only place a real deployment creates app-owned rows,
since `dev-seed` is `UNIFI_MOCK` only and a migration cannot import the seed module.
Running every boot is what carries a release's new canaries into an existing household.
A category's label and monogram follow the seed; domain membership does not. A seeded
domain the household removed keeps its `removedAt` and is shown struck through, so the
removal survives an upgrade and can be undone; a domain the household added is deleted
outright. A domain that has left the shipped seed is left in place rather than deleted.

If a new built-in category's slug belongs to a custom category, boot moves the custom
slug to the first available `-custom`, `-custom-2`, etc. before creating the built-in
category. Its id, label, source, enabled setting, domains and checks are preserved.
The move and seed creation share a transaction; repeated boots do not move it again.

Lists are uncapped. The twenty-per-category figure bounds what FamilyFi ships, not what
a household may add, and the cost note under each list is how growth is priced.

A category mark on a group card shows whichever thing is actually blocking: a FamilyFi
rule that is blocking **at this moment** is the state shown, and otherwise the mark
reports the downstream status — the DNS verdict for that group's resolver.

Actively blocking is not the same as enabled. A scheduled rule outside its window is
switched on and blocking nothing, so it neither claims the mark nor hides a resolver
that genuinely is blocking. `ruleActivelyBlocking()` evaluates that against the
household timezone through the same `inRecurringWindow` the desired-block formula uses,
which is why `schedule.ts` lives in `src/lib` — one implementation, reachable from both
sides. A malformed schedule evaluates to not-blocking rather than throwing: claiming a
block we cannot verify is the worse of the two failures. `categoryMarkState()` is that
rule and nothing else implements it.

A mark has five states, and the colour answers *who* is blocking. Red is FamilyFi's own
policy, the same red as the sheet's Turn off. Purple is the resolver — solid when it
blocks the whole domain list, a tint when it blocks part of it. Green is a measured
all-clear. Grey is "we have not looked". Both blocking states read the word *blocked*
and the partial one reads *partial*; the two that are not blocking carry no word at all.

Green and grey are separate states on purpose. Both mean nothing is blocking, but only
green is a claim about the resolver, and a category we never measured must not borrow
it — that false assurance is the thing this whole feature exists to avoid. It is also
why an app mark, which has no resolver behind it, reports grey rather than green
(`appMarkState()`).

The verdict chips on Categories share this palette rather than keeping their own. They
are driven by the same `UpstreamCheck` row, so a colour cannot mean "the resolver blocks
this" on one screen and "nothing blocks this" on the next; the chips used to paint
*blocked* green, which collided head-on with green meaning all-clear on a mark.

A verdict belongs to a resolver, not to a category. A group may carry its own endpoint
(`Group.dohOverrideUrl`), and `UpstreamCheck` is keyed `(categoryId, groupId)` with a
null group meaning the household default — so a card reports for the devices it actually
has rather than for the rest of the house. `effectiveCheck()` is the only place that
resolution happens; a card asks with its own group, and reading a row out of the array
directly is how a card ends up showing someone else's answer. Between setting an
override and the next sweep a group has no row, and that reports as "not checked"
rather than borrowing the household's.

The unique index is written by hand as `NULLS NOT DISTINCT`: Postgres treats every NULL
as distinct, so the plain index Prisma generates would let a sweep and a "Check now"
each insert their own household row. Sweeps run once per distinct endpoint, so groups
sharing an override share a pass. The override changes what FamilyFi *asks about* a
group — pointing its devices at that resolver is a DHCP or client-side job.

Changing or removing an endpoint clears its checks in the same transaction. Merely
turning checking off, or saving the same URL, keeps the last result. Probe writes and
resolver edits share a short household row lock, so a check cannot race its first insert
or restore a result after an endpoint change. DNS I/O runs outside the transaction;
before storing a result the probe verifies that its endpoint is still configured.

Transport is RFC 8484 wire format (`application/dns-message`) over POST, which every
conforming resolver must accept, so the probe works against any DoH endpoint rather
than the subset that also serves the non-standard `application/dns-json` API.

**Every query carries an EDNS(0) OPT record, and that is load-bearing.** A resolver
only returns an OPT record when the query sent one, and the RFC 8914 Extended DNS Error
that says "I filtered this" rides inside it. Measured against a live NextDNS profile, a
blocked name comes back as **NOERROR with a routable address** — the address of the
provider's block page — and is otherwise indistinguishable from an ordinary answer.
Only the EDE distinguishes it. Drop the OPT record and every block on that provider
reads as "not blocked".

So a name is read as filtered on any of: an EDE of 15 (Blocked), 16 (Censored) or 17
(Filtered); NXDOMAIN; every address being a sinkhole (`0.0.0.0` / `::`); or NOERROR with
no address record. EDE 18 (Prohibited) is deliberately not treated as a block: it says
the client may not query at all, which would apply to every name equally.

Absent an explicit filtering EDE, DNS error codes such as SERVFAIL and REFUSED are
failed observations. Prohibited, truncated and malformed replies also produce `unknown`,
never evidence of upstream filtering. A valid filtering EDE still takes precedence over
an error code because some resolvers deliberately answer blocked queries with REFUSED.

Measured shapes, all four captured live and kept as unit fixtures:

| Resolver | Blocked name answers | EDE |
| --- | --- | --- |
| NextDNS (filtered profile) | routable block-page address | 17 |
| Cloudflare for Families (1.1.1.3) | `0.0.0.0` | 17 |
| Cloudflare (1.1.1.1) | the real address | none |
| Google (8.8.8.8) | the real address | none |

The two filtering resolvers converged on EDE 17 independently. The sinkhole branch is
still needed for a resolver that sinkholes without sending one, and the EDE branch is
the only thing that catches NextDNS, whose answer is otherwise indistinguishable from
the unfiltered ones — the two public resolvers return the same address for that name,
which is what shows NextDNS's is a block page.

This is also why the transport matters beyond conformance. Both filtering resolvers
report the same wire-level EDE, but their JSON APIs spell it differently — Cloudflare
puts it in `Comment`, NextDNS in an `Additional` pseudo-record — so staying on the JSON
API would have meant per-provider parsing of the one field that decides a verdict.

A missing A record alone is not enough to conclude anything, since an IPv6-only name
presents that way, so that one case — and only that one — triggers a follow-up AAAA
query. An EDE, NXDOMAIN or a sinkholed address settles the name on the first query.

## Secrets

Personal passwords are Argon2id hashes. The UniFi API key is AES-256-GCM encrypted with `FAMILYFI_ENCRYPTION_KEY`. The DoH endpoint is **not** encrypted and is returned in full. A resolver URL is configuration, not a credential: a profile id in its path lets someone spend that profile's quota and appear in its logs, but not read those logs or change a setting, and a single-household deployment has no lesser-privileged reader to hide it from. Encrypting it put DNS checking inside the blast radius of an encryption-key rotation and left a mistyped endpoint invisible behind an unknown verdict. Treat it like the rest of the household config — keep it out of pasted dumps. The recovery admin password is never stored in the database; it is compared to `FAMILYFI_DEFAULT_PASSWORD` and printed in the server log at startup so an operator can find it. It is never returned by the API.
