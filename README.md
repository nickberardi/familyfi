# FamilyFi

[![License](https://img.shields.io/badge/license-BSL_1.1-green)](LICENSE)
[![GitHub last commit](https://img.shields.io/github/last-commit/nickberardi/familyfi)](https://github.com/nickberardi/familyfi/commits)
[![GitHub Stars](https://img.shields.io/github/stars/nickberardi/familyfi)](https://github.com/nickberardi/familyfi/stargazers)

Family internet controls for a UniFi gateway. One deployment, one household.

UniFi gives you firewall policies and client lists, but bedtime, no-internet-during-homework, and “who owns this new iPad?” are still a pile of rules you have to remember. FamilyFi is the household layer: groups of people and things, rules and their schedules, and quarantined unknowns. It stores what you want, then enforces it with **app-owned** UniFi firewall policies. Your own policies are never modified, disabled, deleted, or reordered.

The responsive web app / PWA and the companion [iOS project](https://github.com/nickberardi/familyfi-ios) share the `/api/v1` contract.

**[Setup](docs/setup.md)** • **[Operations](docs/operations.md)** • **[API](docs/api.md)** • **[Licensing](docs/licensing.md)**

## What it does

### Family and Things

Put devices into groups that match the house. **Family** groups are people (child, teen, or adult). **Things** are TVs, computers, smart-home kits — anything that is not a person. Every assigned device belongs to exactly one group.

### Rules and schedules

A rule blocks all internet, a category (Video, Social, Gaming…), apps or websites for one or more groups — always, or in named windows such as Homework 3–6 PM on weekdays and Bedtime 10 PM–6 AM. Each window is its own UniFi policy carrying its schedule, so the gateway starts and ends it even if FamilyFi is briefly down, and each is named after the rule and window so UniFi's policy table reads the way your household talks. An internet rule is optional: a TV can have a Video schedule and nothing else. Website rules match domains from DNS lookups, so a device using encrypted DNS can get around them.

### Pause and allow

**Pause all internet** cuts off every device in a group now, for a while or until you resume, and says who paused it. During a scheduled no-internet window, **Allow internet now** lets the group back online until the window ends; category and website rules still apply. Each card shows today's no-internet time — windows, pauses and allowances — with where each came from.

### Unassigned devices

New clients on the VLANs you opted in to manage show up as unassigned (quarantined in the API). FamilyFi discovers them on a short poll and, once you turn quarantine on in Devices, blocks them until you assign them. Quarantine is also the built-in rule on Rules, where it can be paused, extended and resumed like any rule, but not edited. A new household starts with quarantine off, so your own devices stay online while you set up groups. Devices on other VLANs are ignored. Immediate admission control is not promised: a brand-new MAC can have internet until the next successful sync.

### One site, your key

Paste a UniFi Network Integration API key in Settings. FamilyFi encrypts it at rest. It does not create UniFi Object Manager groups and does not issue or rotate keys — that stays in UniFi. Pick which networks (VLANs) it may watch.

## Requirements

- A UniFi console with the Network Integration API (local console URL or cloud connector)
- Network access from the FamilyFi host to that API over HTTPS
- Docker for the recommended install (app + bundled PostgreSQL 18), or Node.js 26+ and pnpm 10 if you run from source
- A box on the LAN. Do not install FamilyFi on the UniFi gateway itself.

Phones on the LAN should use the host’s LAN address, not `localhost`. HTTPS is required for a deployed PWA and for secure cookies in production.

## Installation

### Quick start (Docker)

To build the Docker image locally:

```bash
git clone https://github.com/nickberardi/familyfi.git
cd familyfi
cp .env.example .env
# Set POSTGRES_PASSWORD. Recovery password and crypto secrets are generated on first setup if omitted.
make docker-dev-up
make docker-logs   # look for username: admin and the recovery password
```

Open http://localhost:7001 (override with `FAMILYFI_PORT`). Compose starts the app and PostgreSQL together. For an existing server when you are not using that stack, set `DB_MODE=external` and the `DB_*` values.

To install a published GHCR image (see [releases](docs/operations.md#releases)):

```bash
cp .env.example .env
# Set POSTGRES_PASSWORD.
make docker-up     # pulls ghcr.io/nickberardi/familyfi
```

`make docker-down` stops containers and keeps database volumes.

### From source (development)

```bash
cp .env.example .env
# Set POSTGRES_PASSWORD.
make setup
make dev
```

Open http://localhost:3000. `make setup` starts PostgreSQL via Docker when Docker is available, then migrates. If Docker is not available, run PostgreSQL yourself, point `DB_*` at it, then `make db-migrate`. For UI work without a UniFi console, set `FAMILYFI_MODE=dev`, and add `DB_MODE=memory` to skip PostgreSQL too (see [docs/setup.md](docs/setup.md#modes)).

## First run

1. Open FamilyFi. A new install opens first-time setup before anyone has signed in: its first step hands over the **admin** password to copy (it is `FAMILYFI_DEFAULT_PASSWORD`, also printed in the server log by `make docker-logs` or the `make dev` terminal), and continuing signs you in with it. Setup stays open to anyone on your network until a gateway key is saved; after that FamilyFi asks for sign-in as usual.
2. Paste a UniFi Network Integration API key, pick the networks to watch, add the household and turn on any suggested schedules. Setup accepts a local console's self-signed certificate. Everything it sets can be changed later in Settings and Rules, including certificate checking and **manage all networks**.
3. Align the household timezone with the UniFi console clock so rule windows match wall time.
4. Assign devices to Family or Things groups and add rules.

`FAMILYFI_DEFAULT_PASSWORD` is the permanent recovery credential for username `admin`. Changing it in `.env` takes effect on the next `admin` sign-in. Create personal adult accounts for everyday use; they do not remove `admin`.

Back up PostgreSQL and `FAMILYFI_ENCRYPTION_KEY` together. Restoring the database without that key cannot decrypt the stored UniFi credential.

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

- Issues: [GitHub Issues](https://github.com/nickberardi/familyfi/issues)
- Security: [SECURITY.md](SECURITY.md)
- Docs: [Setup](docs/setup.md), [Architecture](docs/architecture.md), [Operations](docs/operations.md), [API](docs/api.md), [Testing](docs/testing.md)

---

FamilyFi is an independent project and is not affiliated with, endorsed by, or sponsored by Ubiquiti, Inc. Ubiquiti, UniFi, UDM, and Cloud Key are trademarks or registered trademarks of Ubiquiti, Inc.
