# Contributing

See [docs/licensing.md](docs/licensing.md). Sending a pull request accepts the contributor terms below.

Do not send patches that assume MIT/Apache terms, and do not commit `/designs/`, `.env` files, UniFi keys, or unsanitized household API responses.

PRs should include tests and, for any `/api/v1` change, an OpenAPI update in the same change.

**A bug fix ships with a test that fails without it.** Write the test first, watch it fail for the reason the bug report gives, then fix the code. A fix with no such test is incomplete: the bug can come back unnoticed.

`make setup` (or `make hooks` in an existing clone) turns on a pre-push hook that runs lint, typecheck and the unit tests, so a push that would fail those in CI stops on your machine first. Integration, browser and migration checks need PostgreSQL and run in CI; the pull request template lists all of them.

## Contributor terms

By submitting a contribution (including a pull request, patch, or issue with code) to FamilyFi, you agree that:

1. You license your contribution to Nick Berardi (the Licensor) under the Business Source License 1.1 in `LICENSE`, with the same parameters.
2. You grant the Licensor a perpetual, worldwide, non-exclusive, royalty-free copyright license to use, modify, and redistribute your contribution, and to relicense it under the Change License and under separate commercial licenses.
3. You have the right to make this grant. If your employer owns the work, you have permission to contribute it.
4. Your contribution is provided as-is, without warranty.

A GitHub pull request is an electronic signature of this agreement.
