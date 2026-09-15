# FamilyFi

[![License](https://img.shields.io/badge/license-BSL_1.1-green)](LICENSE)
[![GitHub last commit](https://img.shields.io/github/last-commit/nberardi/familyfi)](https://github.com/nberardi/familyfi/commits)
[![GitHub Stars](https://img.shields.io/github/stars/nberardi/familyfi)](https://github.com/nberardi/familyfi/stargazers)

Family internet controls for a UniFi gateway. One deployment, one household.

UniFi gives you firewall policies and client lists, but bedtime, pause-for-homework, and “who owns this new iPad?” are still a pile of rules you have to remember. FamilyFi is the household layer: groups of people and things, schedules, and quarantined unknowns. It stores what you want, then enforces it with **app-owned** UniFi firewall policies. Your own policies are never modified, disabled, deleted, or reordered.

The first client is a responsive web app / PWA. A native app is planned later against the same `/api/v1` API.

**[Setup](docs/setup.md)** • **[Operations](docs/operations.md)** • **[API](docs/api.md)** • **[Licensing](docs/licensing.md)**

## What it does

### Family and Things

Put devices into groups that match the house. **Family** groups are people (child, teen, or adult). **Things** are TVs, computers, smart-home kits — anything that is not a person. Every assigned device belongs to exactly one group. Protection is per group: a protected group is exempt from FamilyFi blocking (your UniFi rules still apply).

### Bedtime schedules

Each group can have a recurring internet window. FamilyFi writes that schedule onto the UniFi policy, so the gateway can start and end bedtime even if FamilyFi is briefly down. Pause is not a “cut the internet” button: it suspends schedule enforcement so internet is available from FamilyFi’s point of view. Resume puts the schedule back, which may still block if it is bedtime. Timed pause and extend are supported.

### Unassigned devices

New clients on the VLANs you opted in to manage show up as unassigned (quarantined in the API). FamilyFi discovers them on a short poll and can block them until you assign them. Devices on other VLANs are ignored. Immediate admission control is not promised: a brand-new MAC can have internet until the next successful sync.

### One site, your key

Paste a UniFi Network Integration API key in Settings. FamilyFi encrypts it at rest. It does not create UniFi Object Manager groups and does not issue or rotate keys — that stays in UniFi. Pick which networks (VLANs) it may watch.

## Requirements

- A UniFi console with the Network Integration API (local console URL or cloud connector)
- Network access from the FamilyFi host to that API over HTTPS
- Docker for the recommended install (app + bundled PostgreSQL 16), or Node.js 20+ and pnpm 10 if you run from source
- A box on the LAN. Do not install FamilyFi on the UniFi gateway itself.

Phones on the LAN should use the host’s LAN address, not `localhost`. HTTPS is required for a deployed PWA and for secure cookies in production.

## Installation

### Quick start (Docker)

Until a published GHCR tag exists, build locally:

```bash
git clone https://github.com/nberardi/familyfi.git
cd familyfi
cp .env.example .env
# Set DB_PASSWORD. Recovery password and crypto secrets are generated on first setup if omitted.
make docker-dev-up
make docker-logs   # look for username: admin and the recovery password
```

Open http://localhost:7001 (override with `APP_PORT`). Compose starts the app and PostgreSQL together. For an existing server when you are not using that stack, set `DB_MODE=external` and the `DB_*` values.

After a GHCR release (`git tag -a v0.1.0` then `git push origin v0.1.0`; see [docs/operations.md](docs/operations.md)):

```bash
cp .env.example .env
# Set DB_PASSWORD.
make docker-up     # pulls ghcr.io/nberardi/familyfi
```

`make docker-down` stops containers and keeps database volumes.

### From source (development)

```bash
cp .env.example .env
# Set DB_PASSWORD.
make setup
make dev
```

Open http://localhost:3000. `make setup` starts PostgreSQL via Docker when Docker is available, then migrates. If Docker is not available, run PostgreSQL yourself, point `DB_*` at it, then `make db-migrate`.

## First run

1. Sign in as **admin** with the recovery password printed in the server log (`make docker-logs` or the `make dev` terminal).
2. In Settings, paste a UniFi Network Integration API key. For a local console with a private CA, enable insecure TLS. Choose **manage all networks** or a VLAN allowlist; the default is none until you pick.
3. Align the household timezone with the UniFi console clock so bedtime windows match wall time.
4. Assign devices to Family or Things groups and set schedules.

`DEFAULT_PASSWORD` is the permanent recovery credential for username `admin`. Changing it in `.env` takes effect on the next `admin` sign-in. Create personal adult accounts for everyday use; they do not remove `admin`.

Back up PostgreSQL and `APP_ENCRYPTION_KEY` together. Restoring the database without that key cannot decrypt the stored UniFi credential.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/licensing.md](docs/licensing.md). Sending a pull request accepts the contributor terms.

Do not send patches that assume MIT/Apache terms. Do not commit `/designs/`, `.env` files, UniFi keys, or unsanitized household API responses. Report bugs via GitHub Issues; sanitize credentials and IPs before attaching logs.

Agent and coding conventions live in [AGENTS.md](AGENTS.md).

## License

Business Source License 1.1. This is **source-available**, not OSI open source.

**Licensor:** Nick Berardi

**Licensed Work:** FamilyFi

**Household use:** You may run it in production for **one household UniFi network** you or that household control, including self-hosted Docker/GHCR on that LAN.

**Commercial use:** Selling, hosting, embedding, white-labeling, or offering FamilyFi (or a substantially similar product) to third parties — including MSP or multi-household service — needs a commercial license. Contact Nick Berardi.

**Change Date:** Four years from publication of that version (see [LICENSE](LICENSE)).

**Change License:** GNU GPL v3 or later

Details: [docs/licensing.md](docs/licensing.md).

## Support

- Issues: [GitHub Issues](https://github.com/nberardi/familyfi/issues)
- Security: [SECURITY.md](SECURITY.md)
- Docs: [Setup](docs/setup.md), [Architecture](docs/architecture.md), [Operations](docs/operations.md), [API](docs/api.md)

---

FamilyFi is an independent project and is not affiliated with, endorsed by, or sponsored by Ubiquiti, Inc. Ubiquiti, UniFi, UDM, and Cloud Key are trademarks or registered trademarks of Ubiquiti, Inc.
