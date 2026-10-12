# FamilyFi

[![License](https://img.shields.io/badge/license-BSL_1.1-green)](LICENSE)
[![GitHub last commit](https://img.shields.io/github/last-commit/nickberardi/familyfi)](https://github.com/nickberardi/familyfi/commits)
[![GitHub Stars](https://img.shields.io/github/stars/nickberardi/familyfi)](https://github.com/nickberardi/familyfi/stargazers)

Family internet controls for a UniFi gateway. One install, one household.

Put each person's devices in a group, set rules such as **Bedtime** or **No social media during homework**, and pause the internet for anyone with one tap, from the web or the [FamilyFi app](https://github.com/nickberardi/familyfi-mobile) on iPhone, iPad, Apple Watch and Android. FamilyFi stores what you want and enforces it with its own UniFi firewall policies. **Your own policies are never modified, disabled, deleted or reordered.**

**[Try the live demo](https://demo.getfamilyfi.com)** • **[User guide](https://github.com/nickberardi/familyfi/wiki)** • **[getfamilyfi.com](https://getfamilyfi.com)**

## Install

On a computer on your home network that runs Docker (not the UniFi gateway itself):

```bash
curl -fsSLO https://raw.githubusercontent.com/nickberardi/familyfi/main/docker/docker-compose.yml
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env
docker compose up -d
```

Open `http://<that computer's address>:7001` and follow first-time setup. You'll need a UniFi Network Integration API key from your console.

The [user guide](https://github.com/nickberardi/familyfi/wiki) covers everything after that:

- [Install](https://github.com/nickberardi/familyfi/wiki/Install) and [first-time setup](https://github.com/nickberardi/familyfi/wiki/First-time-setup)
- [Family, Things and devices](https://github.com/nickberardi/familyfi/wiki/Family-Things-and-devices), including quarantine for unassigned devices
- [Rules, schedules, pause and allow](https://github.com/nickberardi/familyfi/wiki/Rules-schedules-pause-and-allow)
- [Phone and Watch app](https://github.com/nickberardi/familyfi/wiki/Phone-and-Watch-app) and remote access
- [Updates and backups](https://github.com/nickberardi/familyfi/wiki/Updates-and-backups)
- [Troubleshooting and FAQ](https://github.com/nickberardi/familyfi/wiki/Troubleshooting-and-FAQ)

## Development

FamilyFi is a Next.js app with PostgreSQL. Its `/api/v1` HTTP API is shared by the web app, the [mobile app](https://github.com/nickberardi/familyfi-mobile) and AI agents.

```bash
cp .env.example .env   # set POSTGRES_PASSWORD
make setup
make dev               # http://localhost:3000
```

Set `FAMILYFI_MODE=dev` to use a mock gateway and a seeded household instead of a real UniFi console, and add `DB_MODE=memory` to skip PostgreSQL too.

| Reference | |
| --- | --- |
| [Setup](docs/setup.md) | Every environment setting, modes, running from source, sidecars |
| [Operations](docs/operations.md) | Backup and restore, remote access, upgrades, releases |
| [Architecture](docs/architecture.md) | How enforcement, schedules and DNS reports work |
| [API](docs/api.md) | The HTTP contract and authentication ([OpenAPI](openapi/familyfi.v1.yaml)) |
| [Development](docs/development.md) and [testing](docs/testing.md) | Conventions, commands and checks |

### Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md); sending a pull request accepts its contributor terms. Agent and coding conventions are in [AGENTS.md](AGENTS.md). Never commit `/designs/`, `.env` files, UniFi keys or unsanitized household API responses.

## License

FamilyFi is **source-available** under the [Business Source License 1.1](LICENSE), not OSI open source. It is free to run for **one household network** you or that household control. Hosting, selling or offering it to other households, including as an MSP, needs a commercial license from Nick Berardi. Each version becomes GPL v3 or later four years after its release. Details: [docs/licensing.md](docs/licensing.md).

## Support

Report bugs in [GitHub Issues](https://github.com/nickberardi/familyfi/issues), with credentials and IP addresses removed from logs. Security issues: [SECURITY.md](SECURITY.md).

---

FamilyFi is an independent project and is not affiliated with, endorsed by, or sponsored by Ubiquiti, Inc. Ubiquiti, UniFi, UDM, and Cloud Key are trademarks or registered trademarks of Ubiquiti, Inc.
