# Architecture

One Next.js App Router application serves the UI and `/api/v1`. All UniFi calls are server-side.

```text
src/app          pages, layouts, api/v1 route handlers
src/components   shared UI
src/server       env, database, auth, schedule, UniFi, reconciliation
src/lib          client-safe constants and types
prisma           PostgreSQL schema and migrations
openapi          versioned HTTP contract
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

Days identify the local weekday a window starts. Windows are half-open. Evaluation uses the household IANA timezone and local wall time, including both occurrences of a repeated DST time.

## Reconciliation

A database-backed lock serializes startup, interval (~30s), and mutation-triggered runs. Overlapping writers, including container replacement, must not apply stale revisions. This process is a no-op until UniFi is configured (Phase 2).

## Secrets

Personal passwords are Argon2id hashes. The UniFi API key is AES-256-GCM encrypted with `APP_ENCRYPTION_KEY`. The recovery admin password is never stored; it is compared to `DEFAULT_PASSWORD`.
