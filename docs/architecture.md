# Architecture

One Next.js App Router application serves the UI and `/api/v1`. All UniFi calls are server-side.

```text
src/app          pages, layouts, api/v1 route handlers
src/components   shared UI
src/server       env, database, auth, schedule, UniFi, reconciliation
src/lib          client-safe constants and types
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

## UniFi client (Phase 1)

`src/server/unifi` talks to the official Network Integration API (v10.4.57) with `X-API-KEY`. Pagination uses limit 200. Internet-block policies use firewall action `BLOCK` (live spike: better than `REJECT` on this gateway). Policy enable/disable is PUT of the full write body. The client refuses PUT on policy ordering. The spike CLI (`scripts/spike`) is the live gate; mocks and fixtures do not prove enforcement.

## Secrets

Personal passwords are Argon2id hashes. The UniFi API key is AES-256-GCM encrypted with `APP_ENCRYPTION_KEY`. The recovery admin password is never stored in the database; it is compared to `DEFAULT_PASSWORD` and printed in the server log at startup so an operator can find it. It is never returned by the API.
