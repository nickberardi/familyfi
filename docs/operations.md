# Operations

## Recovery admin

Username `admin` with `DEFAULT_PASSWORD` remains available after personal adult accounts exist. Changing `DEFAULT_PASSWORD` in the environment takes effect on the next `admin` sign-in. Restart is not required for the comparison, but the process must see the new environment value.

## Backup and restore

Back up PostgreSQL and `APP_ENCRYPTION_KEY` together. Restoring the database without that key cannot decrypt the stored UniFi credential. Ordinary `make docker-down` does not delete volumes.

## Database modes

- `DB_MODE=bundled`: Compose starts PostgreSQL with a named volume. The database port is not published on the host.
- `DB_MODE=external`: the application uses `DB_HOST` and related settings. Bundled PostgreSQL is not started and is not a health-check dependency.

Users should not edit Compose YAML to pick a server.

## Outages

While FamilyFi is stopped or cannot reach UniFi, the gateway keeps the last applied policies. Bedtime can start or end late, and a timed Pause can outlast its expiry. Startup reconciliation applies current desired state; it does not replay missed transitions. Native gateway scheduling is not used in this version.

## Unresolved app policies

If a create may have succeeded but ownership cannot be proven, later phases report an actionable unresolved operation instead of adopting arbitrary `fam-` prefix matches. Do not delete administrator rules to recover.

## Upgrades

Release images run `prisma migrate deploy` on start. They do not run development migrations.
