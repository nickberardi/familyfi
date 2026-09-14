# API

The web UI and any future native client use `/api/v1`. The source of truth is [`openapi/familyfi.v1.yaml`](../openapi/familyfi.v1.yaml).

## Implemented in Phase 0

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/health` | No secrets |
| POST | `/api/v1/auth/login` | Cookie session or native bearer |
| POST | `/api/v1/auth/logout` | CSRF for cookies; bearer for native |
| GET | `/api/v1/auth/session` | Current principal |

Browser mutations after login send `X-CSRF-Token` matching the `familyfi_csrf` cookie. Native clients send `Authorization: Bearer`.

## Planned (backend phase)

Accounts, groups, schedules (including pause/resume/extend), devices/assignment, sync/changes, and household/UniFi settings. Those routes are not present until they are implemented and documented in the same change.

Normal payloads never return password hashes, `DEFAULT_PASSWORD`, raw UniFi keys, or firewall JSON.
