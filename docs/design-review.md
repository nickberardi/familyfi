# Design review

Local files under `designs/` are private implementation references. They are gitignored and dockerignored. Production behavior follows `docs/plan.md` when a prototype disagrees.

## Card System

- One card; `kind` in the prototype is `person | group` and maps to Family / Things.
- Kind sets the identity mark and wording (bedtime vs schedule). Surface sets density: comfortable, compact, dense.
- Mark sizes: 44 (comfortable, Things only), 32 compact, 24 dense. Family comfortable cards are markless.
- State ink: available `#248a3d`, paused `#c04c00`, not applied `#ff3b30`, protected/locked uses muted text that still meets contrast.
- Grey grounds get no card border; white/light pages get a 1px line.

## Web Design

Reference for Family, Things, Schedules, Devices, Quarantined, Reconciliation, Settings, assignment, roles, and API-key replacement. Desktop follows this layout; phone follows Card System specimens.

Prototype issues to replace:

- Pause currently means “block internet now” and Resume toasts “back online”. Production Pause suspends schedule enforcement; Resume restores the schedule, which may still block during bedtime.
- “House” as a destination becomes an ordinary Things group.
- Unassigned devices are named **Quarantined devices** everywhere.
- Member “app-owned policies” JSON/names are troubleshooting-only, not the parent Family view.
- Protected groups must not expose controls that bypass protection.
- Instant success toasts, sample keys (`ak_live_…`), and gateway facts are examples.

## Sign In

Keep the visual system (card, field, primary button, error). Adapt the flow:

- Username plus password. Recovery `admin` and personal adult usernames.
- No magic link, no email reset, no “Forgot?” email path.
- Do not promise lockout copy that is not implemented; throttling is 5 failures / 15 minutes then HTTP 429.
- Children and teens do not sign in.

## Accessibility overrides

Prototype type often sits at 11–13px and uses low-alpha grey. Production:

- Readable text is at least 14px.
- Contrast against page/card backgrounds is at least 4.5:1. Muted copy uses `#3a3a3c` rather than `rgba(60,60,67,.5)`.
