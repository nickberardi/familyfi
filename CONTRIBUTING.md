# Contributing

FamilyFi is a Next.js app with PostgreSQL. Its `/api/v1` HTTP API is shared by the web app, the [mobile app](https://github.com/nickberardi/familyfi-mobile) and AI agents. The [README](README.md) and the [user guide](https://github.com/nickberardi/familyfi/wiki) are for households running FamilyFi; this page and `docs/` are for people working on it.

## Run from source

```bash
cp .env.example .env   # set POSTGRES_PASSWORD
make setup
make dev               # http://localhost:3000
```

Set `FAMILYFI_MODE=dev` to use a mock gateway and a seeded household instead of a real UniFi console, and add `DB_MODE=memory` to skip PostgreSQL too. [Setup](docs/setup.md#local-development) has the details.

| Reference | |
| --- | --- |
| [Setup](docs/setup.md) | Every environment setting, modes, running from source, sidecars |
| [Operations](docs/operations.md) | Backup and restore, remote access, upgrades, releases |
| [Architecture](docs/architecture.md) | How enforcement, schedules and DNS reports work |
| [API](docs/api.md) | The HTTP contract and authentication ([OpenAPI](openapi/familyfi.v1.yaml)) |
| [Development](docs/development.md) and [testing](docs/testing.md) | Conventions, commands and checks |
| [Design system](docs/design.md) | How FamilyFi looks and reads, kept in step with the design project |

## Pull requests

See [docs/licensing.md](docs/licensing.md). Sending a pull request accepts the contributor terms below.

Do not send patches that assume MIT/Apache terms, and do not commit `/designs/`, `.env` files, UniFi keys, or unsanitized household API responses.

Follow the workflow in [AGENTS.md](AGENTS.md) and the [development conventions](docs/development.md). PRs include validation appropriate to the change, tests for behaviour changes, and an OpenAPI update when the HTTP contract changes. An internal API refactor with unchanged HTTP behaviour needs no spec edit. **A bug fix ships with a test that fails without it.**

[docs/testing.md](docs/testing.md) says what to run for your change and the rules tests follow. `make setup` (or `make hooks` in an existing clone) turns on a pre-push hook that runs lint, typecheck and the unit tests.

## Contributor terms

By submitting a contribution (including a pull request, patch, or issue with code) to FamilyFi, you agree that:

1. You license your contribution to Nick Berardi (the Licensor) under the Business Source License 1.1 in `LICENSE`, with the same parameters.
2. You grant the Licensor a perpetual, worldwide, non-exclusive, royalty-free copyright license to use, modify, and redistribute your contribution, and to relicense it under the Change License and under separate commercial licenses.
3. You have the right to make this grant. If your employer owns the work, you have permission to contribute it.
4. Your contribution is provided as-is, without warranty.

A GitHub pull request is an electronic signature of this agreement.
