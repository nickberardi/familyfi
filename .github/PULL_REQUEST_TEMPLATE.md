## Pull request

### Summary

-

### Plan

<!--
If this work came from a plan, paste it here in full, inside a <details> block, and
note anything that shipped differently. See "Pull requests" in AGENTS.md.
-->

_No plan — direct change._

### Test plan

<!-- What to run for which change: docs/testing.md -->

- [ ] `make lint typecheck test-coverage` passes
- [ ] `make test-browser` passes, or the change does not touch the UI
- [ ] `make test-api` passes, or no route or payload changed. A spec change has an issue in `familyfi-ios`
- [ ] `make db-migrate db-drift db-upgrade` passes, or the change has no migration
- [ ] A bug fix comes with a test that fails without the fix
- [ ] No secrets, live UniFi responses, or `/designs/` files included
