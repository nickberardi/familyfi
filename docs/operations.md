# Operations

## Recovery admin

Username `admin` with `DEFAULT_PASSWORD` remains available after personal adult accounts exist. If `.env` has no usable recovery password, FamilyFi generates one and stores it as `DEFAULT_PASSWORD`. The running server prints that username and password in a boxed log line at startup (`make dev` or `make docker-logs`). Changing `DEFAULT_PASSWORD` in `.env` takes effect on the next `admin` sign-in. Do not put this password in the API or in issues.

## Backup and restore

Back up PostgreSQL and `APP_ENCRYPTION_KEY` together (it lives in `.env` after first setup). Restoring the database without that key cannot decrypt the stored UniFi credential. Ordinary `make docker-down` does not delete volumes. Do not regenerate `APP_ENCRYPTION_KEY` once a UniFi key has been saved.

## Database modes

- `DB_MODE=bundled`: Compose starts PostgreSQL with a named volume. The database port is not published on the host.
- `DB_MODE=external`: the application uses `DB_HOST` and related settings. Bundled PostgreSQL is not started and is not a health-check dependency.

Users should not edit Compose YAML to pick a server.

## Outages

While FamilyFi is stopped or cannot reach UniFi, the gateway keeps the last applied policies **including UniFi policy schedules**. Recurring bedtime can still start and end. A timed Pause/Extend can outlast its expiry until FamilyFi PUTs `enabled: true`. New devices on **managed** VLANs can have internet until the next successful quarantine reconciliation. Unmanaged VLANs are never ingested. Startup reconciliation applies current desired state; it does not replay missed transitions.

## Unresolved app policies

If a create may have succeeded but ownership cannot be proven, later phases report an actionable unresolved operation instead of adopting arbitrary `FamilyFi ` prefix matches. Do not delete administrator rules to recover.

## Upgrades

Release images run `prisma migrate deploy` on start. They do not run development migrations.
