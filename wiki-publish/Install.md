# Install

FamilyFi runs as a few Docker containers on a computer in your home: the app, its database, and a small updater that installs new versions when you ask.

## What you need

- **A UniFi console** running UniFi Network, such as a Cloud Gateway, Dream Machine or Dream Router.
- **A computer on your home network that runs Docker**, and stays on: a mini PC, a NAS with Docker, a Raspberry Pi 4 or 5, or a home server. Intel/AMD and ARM both work. Don't install FamilyFi on the UniFi gateway itself.
- **About 10 minutes.**

## Install with Docker Compose

On that computer, make a folder for FamilyFi and run these three commands in it:

```bash
curl -fsSLO https://raw.githubusercontent.com/nickberardi/familyfi/main/docker/docker-compose.yml
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env
docker compose up -d
```

The second line makes a random password for FamilyFi's database and saves it in `.env`. You never need to type it, but keep the `.env` file.

Then open **http://&lt;that computer's address&gt;:7001** in a browser, for example `http://192.168.1.20:7001`. FamilyFi opens [first-time setup](First-time-setup).

## Ports

| Port | What it is |
| --- | --- |
| **7001** | The FamilyFi website. Keep it on your home network; never forward it from your router. |
| **7002** | The remote access port, used only by the phone app when you set up remote access yourself. It answers nothing until you turn that on. See [Phone and Watch app](Phone-and-Watch-app). |

If 7001 is already taken, add `FAMILYFI_PORT=8080` (or any free port) to `.env` and run `docker compose up -d` again.

## Your admin password

FamilyFi makes a password for the built-in **admin** account the first time it starts, and setup shows it to you to copy. Save it in your password manager: it is the recovery account, and it always works even after you add personal accounts.

If you lose it, it's printed in the log every time FamilyFi starts:

```bash
docker compose logs app | grep -A1 "username: admin"
```

## Stopping and starting

```bash
docker compose stop      # stop FamilyFi
docker compose up -d     # start it again
```

Your household is kept in Docker volumes, so stopping, restarting or rebooting the computer loses nothing. While FamilyFi is stopped, your gateway keeps enforcing the last rules it was given, schedules included.

## Advanced

Running from source, using your own PostgreSQL server, or every setting FamilyFi reads: see the [setup reference](https://github.com/nickberardi/familyfi/blob/main/docs/setup.md).
