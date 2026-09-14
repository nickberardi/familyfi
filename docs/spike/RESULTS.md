# UniFi spike — live gate

**Status: MAC block/restore passed.** Local console, `BLOCK` + `enabled` toggle, operator-confirmed internet loss and restore, spike policy deleted. Overnight UniFi `schedule`, IPv6, and a second concurrent MAC were not required for this gate. Phase 2 uses the agreed schedule/`enabled` model.

Official contract used by the client: UniFi Network Integration API **10.4.57**. Live Network application: **10.6.106**. Auth header: `X-API-KEY`.

## Connection modes

| Mode | Integration base | Live |
| --- | --- | --- |
| Local | `https://<console-ip>/proxy/network/integration` then `/v1/...` | Verified at `https://10.1.2.1/proxy/network/integration` (private CA; spike sets `UNIFI_TLS_INSECURE=1`) |
| Cloud | `https://api.ui.com/v1/connector/consoles/{consoleId}/proxy/network/integration` | not tested |

A bare console hostname is not an integration base.

## Client → source zone mapping (documented fields)

Official client overview/details **do not include `networkId`**. Mapping used by the spike:

1. `GET /v1/sites/{siteId}/networks/{networkId}/references` `CLIENT` `referenceId`s
2. Else match `client.ipAddress` to gateway network `ipv4Configuration.hostIpAddress` + `prefixLength` (and `additionalHostIpSubnets`)
3. Zone via `network.zoneId` and/or `zone.networkIds`

Live: a connected test MAC mapped **Internal → External** via IPv4 subnet. MACs not in `GET /v1/clients` cannot be targeted until they appear.

Destination zone: first of External, WAN, Internet (case-insensitive). Source: one policy per source zone. IP scope: `IPV4_AND_IPV6` with no protocol filter (all protocols). PATCH is logging-only; enable/disable uses PUT of the full write payload.

**Action: `BLOCK`, not `REJECT`.** Live use found BLOCK more effective. FamilyFi create/update payloads use `action.type = BLOCK`.

**Policy `schedule` and Pause:** UniFi firewall policies can carry a schedule (`null` = always active). Official modes: `EVERY_DAY`, `EVERY_WEEK` (days + `startTime`/`stopTime`), `CUSTOM` (date range), `ONE_TIME_ONLY`. The UI Pause control is the documented `enabled` flag (PATCH cannot toggle it; PUT the full write body).

Working model for Phase 2 (agreed):

- Recurring bedtime → persist `EVERY_WEEK` (or `EVERY_DAY`) on the app-owned policy; the gateway enforces the window without FamilyFi.
- FamilyFi Pause / Resume → `enabled: false` / `enabled: true`. Resume leaves the UniFi schedule in place, so bedtime can still block.
- Timed Pause / Extend → `enabled: false` now; the only clock-driven write is setting `enabled: true` at expiry (reconciliation interval).
- Quarantine / MAC membership / protection still need reconciliation. Indefinite Pause needs no timer.

Unproven: overnight windows (21:30–06:45) on UniFi’s scheduler, console clock vs household IANA timezone.

`GET /v1/sites/{siteId}/firewall/policies/ordering` on this console requires `sourceFirewallZoneId`. Ordering PUT is still never called.

## Working create payload (sanitized)

See `tests/fixtures/unifi/create-policy.request.json`. Names: `FamilyFi Spike {zoneName} Devices`.

## Live observations

| Item | Result |
| --- | --- |
| Console / Network version | Network 10.6.106, local integration base |
| Connection mode | local |
| Action | **BLOCK** (operator: better than REJECT) |
| UniFi policy schedule | Present; Phase 2 will persist bedtime here |
| Internet loss when `enabled` | **Pass** (operator, test client) |
| Internet restore when `enabled: false` | **Pass** (operator, test client) |
| LAN still works on test client | not recorded |
| Unrelated clients unaffected | not recorded |
| IPv6 | not recorded |
| Multi-MAC membership | one of two listed MACs was connected |
| Admin policy relative order after delete | cleanup reported preserved |
| Cleanup | **Pass:** spike policy deleted |

## Verification method

Operator-assisted: test client lost internet with policy enabled, regained it after PUT `enabled: false`, then DELETE. API readback is not a connectivity probe.

## Cleanup / recovery

Spike state is gitignored (`scripts/spike/.live-state.json`). If DELETE fails, keep those policy ids and do not delete administrator policies.
