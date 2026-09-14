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

## Upgrades

Release images run `prisma migrate deploy` on start. Local `make dev` does the same (`migrate deploy` plus `prisma generate`) before Next listens, so a new column cannot 500 login or Settings until the process is restarted. They do not run `prisma migrate dev`.

Published GHCR tags are `linux/amd64` and `linux/arm64` (`v*` git tags via Actions). Until a tag exists, use `make docker-dev-up`. The entrypoint does not need a `.env` file when `DEFAULT_PASSWORD`, `SESSION_SECRET`, and `APP_ENCRYPTION_KEY` are already in the process environment.

## Releases

`package.json` is `0.1.0`. Publish that version with an annotated git tag that matches semver, then push the tag. Do not use `v0.1`; the release workflow’s Docker tags need a full `MAJOR.MINOR.PATCH`.

```bash
git checkout main
git pull
git tag -a v0.1.0 -m "FamilyFi 0.1.0"
git push origin v0.1.0
```

Pushing `v*` runs [`.github/workflows/release.yml`](../.github/workflows/release.yml): a multi-arch image (`linux/amd64` and `linux/arm64`) to `ghcr.io/nberardi/familyfi` (`0.1.0`, `0.1`, and `latest`) and a GitHub Release with generated notes. After the first package appears, link it to the repository in GitHub Packages if GHCR is not yet public.

Bump `package.json` (and `openapi/familyfi.v1.yaml` `info.version`) before a later tag so Settings, the sign-in screen, and `GET /api/v1/health` show the same number as the image tag.
