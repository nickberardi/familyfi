# DNS categories

How FamilyFi observes DNS filtering. [Architecture](architecture.md) has the system map; this is the detail behind its *Upstream DNS categories* section.

A second, independent signal: domain-list categories resolved through the DNS servers
UniFi DHCP gives managed networks, or an explicit DoH override. **Reporting only.**
Nothing here creates, changes or deletes a UniFi policy, so these routes return no
`change` object and never enqueue reconciliation. UniFi remains the sole enforcement
path.

A verdict has four values and the fourth carries the weight. Every canary blocked is
`blocked`, some is `partial`, none is `open`, and any domain we could not resolve makes
the category `unknown` regardless of the rest. A failed query is a failure to observe,
not an observation: reporting `open` off a failed sweep would tell a parent nothing is
filtered when the truth is that we do not know, and reporting `blocked` would be a false
assurance. Unknown DHCP configuration, an unreachable server and an empty list are all
`unknown` for the same reason.

The same rule holds one level down. Each `UpstreamCheck` keeps the raw per-domain
results from its sweep (`{ domain, blocked }`), which the Category detail screen shows
next to each domain. `domainVerdict()` (`src/lib/upstream.ts`) is the one place that
resolves it: a domain absent from the sweep — never probed, or added since — reads
`unknown`, not `open`, and a domain a household has struck through reads `unknown`
regardless of what an older sweep, taken before the strike, still says about it. Removing
a domain does not touch past checks, so without that second rule a stale `blocked: true`
would outlive the strike-through it sits beside.

`src/lib/upstream-domains.ts` is a **seed, not runtime data**. The probe reads the
database. `ensureUpstreamCategories()` runs at every boot beside
`ensureRecoveryAccount()` — the only place a real deployment creates app-owned rows,
since `dev-seed` runs only with the UniFi mock and a migration cannot import the seed module.
Running every boot is what carries a release's new canaries into an existing household.
A category's label and monogram follow the seed; domain membership does not. A seeded
domain the household removed keeps its `removedAt` and is shown struck through, so the
removal survives an upgrade and can be undone; a domain the household added is deleted
outright. A domain that has left the shipped seed is left in place rather than deleted.

If a new built-in category's slug belongs to a custom category, boot moves the custom
slug to the first available `-custom`, `-custom-2`, etc. before creating the built-in
category. Its id, label, source, enabled setting, domains and checks are preserved.
The move and seed creation share a transaction; repeated boots do not move it again.

The sweep runs on a household-local wall-clock schedule — `Household.dohProbeTime`
("HH:MM") and `dohProbeDays` (0 Sunday–6 Saturday, Sunday by default) evaluated
against `Household.timezone` — not an interval counted from the last boot. A single
`setTimeout` is re-armed after each fire (`src/server/upstream/schedule.ts`), reusing
`nextClockOnDays` (`src/lib/display.ts`), the same DST-correct function behind a rule
window's next start and end. A restart is not itself a trigger: at boot, and on every timer
fire, the process claims the currently-due scheduled instant with a conditional update
(`dohProbeLastRunAt IS NULL OR < due`) inside the existing upstream lock before
sweeping. This is what lets a restart shortly after the scheduled time still catch up
that day's report exactly once, and what keeps two processes off the same run without a
second lock table — one deployment serves one household, so a claim column is enough.
Changing the probe time, days, or the household timezone re-arms the timer immediately
rather than waiting for the next restart.

Lists are uncapped. The twenty-per-category figure bounds what FamilyFi ships, not what
a household may add, and the cost note under each list is how growth is priced.

A category mark on a group card shows whichever thing is actually blocking: a FamilyFi
rule that is blocking **at this moment** is the state shown, and otherwise the mark
reports the downstream status — the DNS verdict for that group's resolver.

Actively blocking is not the same as enabled. A scheduled rule outside its window is
switched on and blocking nothing, so it neither claims the mark nor hides a resolver
that genuinely is blocking. `ruleActivelyBlocking()` evaluates that against the
household timezone through the same `isWindowActive` the desired-block formula uses,
which is why `rule-windows.ts` lives in `src/lib` — one implementation, reachable from
both sides. A malformed schedule evaluates to not-blocking rather than throwing: claiming a
block we cannot verify is the worse of the two failures. `categoryMarkState()` is that
rule and nothing else implements it.

A mark has five states, and the colour answers *who* is blocking. Red is FamilyFi's own
policy, the same red as the sheet's Turn off. Purple is the resolver — solid when it
blocks the whole domain list, a tint when it blocks part of it. Green is a measured
all-clear. Grey is "we have not looked". Both blocking states read the word *blocked*
and the partial one reads *partial*; the two that are not blocking carry no word at all.

Green and grey are separate states on purpose. Green means the probe observed no upstream
block; grey means the upstream result is unknown. A category we never measured must not borrow
green — that false assurance is the thing this whole feature exists to avoid. It is also
why an app mark, which has no resolver behind it, reports grey rather than green
(`appMarkState()`).

The verdict chips on Categories share this palette rather than keeping their own. They
are driven by the same `UpstreamCheck` row, so a colour cannot mean "the resolver blocks
this" on one screen and "nothing blocks this" on the next; the chips used to paint
*blocked* green, which collided head-on with green meaning all-clear on a mark.

A verdict belongs to a resolver, not to a category. `UpstreamCheck` is keyed
`(categoryId, groupId)` with a null group meaning the household aggregate. DHCP-backed
groups have their own rows for the networks holding their devices; a group with
`Group.dohOverrideUrl` has a row for its endpoint. A group inheriting household DoH
uses the household row. `effectiveCheck()` applies that choice wherever the group
appears. Between setting an override and the next sweep a group has no row, and that
reports as "not checked" rather than borrowing the household's.

The unique index is written by hand as `NULLS NOT DISTINCT`: Postgres treats every NULL
as distinct, so the plain index Prisma generates would let a sweep and a "Check now"
each insert their own household row. Sweeps run once per distinct endpoint, so groups
sharing an override share a pass. The override changes what FamilyFi *asks about* a
group — pointing its devices at that resolver is a DHCP or client-side job.

DHCP discovery uses each managed network's `SERVER`-mode addresses, or that network's
gateway address when UniFi selects DNS automatically. Relay and missing DHCP settings
are unknown. Each assigned server is checked; group results cover the networks holding
its assigned devices. Differing complete answers are partial, and an unavailable server
makes the aggregate unknown. Group DoH overrides win over household DoH overrides, which
win over discovery. Each check stores its source and network/server snapshot.

Changing a resolver or turning checking off clears affected checks. A manual check can
run while automatic checking is off; results older than seven days are hidden. Probe writes and
resolver edits share a short household row lock, so a check cannot race its first insert
or restore a result after an endpoint change. DNS I/O runs outside the transaction;
before storing a result the probe verifies that its endpoint is still configured.

DoH uses RFC 8484 wire format (`application/dns-message`) over POST. DHCP-discovered
servers use plain DNS over UDP 53, retrying a truncated answer over TCP 53. Both
transports share wire decoding and blocked-response interpretation.

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
