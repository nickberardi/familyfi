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

- [ ] `pnpm lint` and `pnpm typecheck` pass
- [ ] `pnpm test:coverage` passes: unit and integration tests, coverage floors, and every API response checked against the OpenAPI document
- [ ] `pnpm test:browser` passes, or the change does not touch the UI
- [ ] `pnpm test-api` passes; OpenAPI updated in the same change when routes or payloads change, with an issue opened in `familyfi-ios`
- [ ] `pnpm db-drift` and `pnpm db-upgrade` pass, or the change has no migration
- [ ] A bug fix comes with a test that fails without the fix
- [ ] No secrets, live UniFi responses, or `/designs/` files included
