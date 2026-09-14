# Phase 4 verification evidence

Ordinary GitHub Actions does not reach the household gateway. Live UniFi writes stay on an operator checklist. Licensing is a **public-release** gate, not a verification gate.

## Automated (this change)

| Check | How |
| --- | --- |
| Unit | `pnpm test` — MAC, DST/overnight windows, payloads, ownership, protection, Pause/Resume/Extend |
| OpenAPI | `pnpm test-api` — path/method/`operationId` parity with route handlers + Redocly |
| Integration | `pnpm test:integration` against isolated PostgreSQL `familyfi_test` and `MockUnifiClient` |
| Auth | Recovery admin, personal adult lifecycle, CSRF vs bearer, session revoke, throttle, secret redaction |
| API | Session-required `/api/v1` handlers, change polling, group delete → quarantine |
| Production build | `pnpm build` in CI |
| Browser | Playwright Chromium desktop + Pixel 7 viewport: sign-in, Family/Things/Schedules/Devices/Sync/Settings/API |
| Containers | `scripts/check-image.sh` (no `designs/`, no baked `.env`, OpenAPI present) and `scripts/container-smoke.sh` (external Postgres, password `p@ss/w:rd`, health, login, restart). Local `familyfi:dev` smoke passed after the image copies `prisma/` and `.env.example`, and `ensureSecrets` accepts a complete process env without a mounted `.env`. |
| GHCR | `.github/workflows/release.yml` publishes `linux/amd64` on `v*` tags |

Integration tests never use the development `familyfi` database.

## Live UniFi

See [LIVE.md](LIVE.md) and [spike results](../spike/RESULTS.md). IPv6, overnight UniFi scheduler, and a second concurrent MAC remain unproven. Do not claim dual-stack blocking.

## Public release

Licensing is [Business Source License 1.1](../licensing.md). Making the GitHub repository public is still a separate decision.
