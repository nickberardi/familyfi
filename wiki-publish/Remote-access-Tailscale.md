# Remote access with Tailscale

If your phones already use [Tailscale](https://tailscale.com), FamilyFi can join your tailnet as its own machine, and the app reaches it at an address like `https://familyfi.your-tailnet.ts.net`. Nothing is opened to the internet.

## Before you start

In the [Tailscale admin console](https://login.tailscale.com/admin):

1. Under **DNS**, turn on **MagicDNS** and **HTTPS Certificates**.
2. Under **Settings → Keys**, generate an **auth key** for the FamilyFi container.

Each phone that will use FamilyFi needs the Tailscale app, signed in to the same tailnet.

## Add the Tailscale container

In the folder where you [installed](Install) FamilyFi:

1. Add the auth key to `.env`:

   ```bash
   echo "TS_AUTHKEY=tskey-auth-..." >> .env
   ```

2. Create a folder named `tailscale` with a file `serve.json` in it:

   ```json
   {
     "TCP": { "443": { "HTTPS": true } },
     "Web": {
       "${TS_CERT_DOMAIN}:443": {
         "Handlers": { "/": { "Proxy": "http://app:7002" } }
       }
     }
   }
   ```

3. Create `docker-compose.override.yml` next to `docker-compose.yml`. Docker Compose reads it automatically, and it survives when you replace `docker-compose.yml` with a newer one.

   ```yaml
   services:
     tailscale:
       image: tailscale/tailscale:stable
       hostname: familyfi
       restart: unless-stopped
       environment:
         TS_AUTHKEY: ${TS_AUTHKEY:?Set TS_AUTHKEY in .env}
         TS_HOSTNAME: familyfi
         TS_STATE_DIR: /var/lib/tailscale
         TS_SERVE_CONFIG: /config/serve.json
       volumes:
         - tailscale-state:/var/lib/tailscale
         - ./tailscale:/config:ro
       depends_on:
         - app

   volumes:
     tailscale-state:
   ```

4. Start it:

   ```bash
   docker compose up -d
   ```

A machine named **familyfi** appears in your Tailscale admin console. Its full address is shown there, for example `familyfi.tail1234.ts.net`.

> `http://app:7002` is FamilyFi's remote access port, which only answers the phone app. Never point Tailscale at port 7001, which is the website.

## Turn it on in FamilyFi

On **Pair Device → Remote access**, choose **Tailscale**, enter `https://familyfi.<your tailnet>.ts.net`, and save. Then [pair your phones](Phone-and-Watch-app#pair-your-phone).

Use Tailscale **Serve**, as above, never **Funnel**: Funnel would put FamilyFi on the public internet.
