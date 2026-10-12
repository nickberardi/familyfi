# Remote access with Tailscale

If your family already uses [Tailscale](https://tailscale.com), FamilyFi can join your tailnet as a machine of its own. A small Tailscale container runs next to FamilyFi and uses **Tailscale Serve** to give it an HTTPS address, such as `https://familyfi.tail1234.ts.net`. The FamilyFi app reaches home at that address whenever the phone's Tailscale app is connected. Nothing is opened to the internet, and you don't change your router.

**Pick this if** your phones already run Tailscale, or you're happy to install it, and you want a permanent address without a domain name or port forwards.

**Not for you if** you don't want a VPN app running on every phone that uses FamilyFi. Try **Cloudflare** or **Quick tunnel** instead (see [Phone and Watch app](Phone-and-Watch-app#choose-how-your-phone-reaches-home)).

## What you need

- FamilyFi [installed](Install) with Docker Compose.
- A Tailscale account. You must be an Owner, Admin, IT admin or Network admin of the tailnet to make an auth key.
- The Tailscale app on every phone that will use FamilyFi, signed in to the same tailnet.

## Set it up

### 1. Prepare your tailnet

In the [Tailscale admin console](https://login.tailscale.com/admin):

1. Open **DNS**. Turn on **MagicDNS** if it isn't on already.
2. On the same page, under **HTTPS Certificates**, select **Enable HTTPS**.

   Tailscale's certificates are listed in a public log, so the machine name (`familyfi`) and your tailnet name become public. Nothing else does.
3. Open **Settings → Keys** and select **Generate auth key**. Give it a description such as *FamilyFi*.
   - Leave **Reusable** off. FamilyFi's container only signs in once.
   - Leave **Ephemeral** off. An ephemeral machine is removed when it goes offline, and your phones would lose its address.
   - Tags are optional. If your tailnet uses access rules with tags, add the tag your phones are allowed to reach.
   - Any expiry is fine. It only limits how long the key can be used to sign in; the machine stays signed in after the key expires.
4. Select **Generate key** and copy it. Tailscale doesn't show it again.

### 2. Add the Tailscale container

Work in the folder where you [installed](Install) FamilyFi, next to `docker-compose.yml` and `.env`.

1. Add the auth key to `.env`:

   ```bash
   echo "TS_AUTHKEY=tskey-auth-..." >> .env
   ```

2. Make a folder named `tailscale`, and in it a file named `serve.json`:

   ```json
   {
     "TCP": {
       "443": { "HTTPS": true }
     },
     "Web": {
       "${TS_CERT_DOMAIN}:443": {
         "Handlers": {
           "/": { "Proxy": "http://app:7002" }
         }
       }
     },
     "AllowFunnel": {
       "${TS_CERT_DOMAIN}:443": false
     }
   }
   ```

   Copy it exactly. `${TS_CERT_DOMAIN}` is not something you fill in: the Tailscale container replaces it with the machine's own address when it starts. `http://app:7002` is FamilyFi's remote access port, and `"AllowFunnel": false` keeps the address inside your tailnet.

3. Create `docker-compose.override.yml` next to `docker-compose.yml`. Docker Compose reads it automatically, and it stays put when you download a newer `docker-compose.yml`.

   ```yaml
   services:
     tailscale:
       image: tailscale/tailscale:stable
       container_name: familyfi-tailscale
       restart: unless-stopped
       environment:
         TS_AUTHKEY: ${TS_AUTHKEY:?Set TS_AUTHKEY in .env}
         TS_AUTH_ONCE: "true"
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

   - `TS_AUTH_ONCE` signs in only the first time, so a restart doesn't need the key again.
   - `TS_STATE_DIR` and the `tailscale-state` volume keep the machine's identity. Without them, every restart would add a new machine with a new address.
   - The `tailscale` folder is mounted as a folder, not just the file, as Tailscale requires, so it notices when you edit `serve.json`.
   - No extra permissions or ports are needed. The container uses Tailscale's default userspace networking, and reaches FamilyFi over Docker's own network.

4. Start it:

   ```bash
   docker compose up -d
   ```

A machine named **familyfi** appears on the **Machines** page of the Tailscale admin console. Its full name is shown there, for example `familyfi.tail1234.ts.net`. That is your address: `https://familyfi.tail1234.ts.net`.

5. Optional but recommended: on the **Machines** page, open the menu next to **familyfi** and choose **Disable key expiry**. Otherwise Tailscale signs the machine out after 180 days, and phones lose the connection until you sign it in again. (A machine with a tag already has key expiry turned off.)

> **Point Tailscale only at `http://app:7002`.** That is FamilyFi's remote access port, which only answers the phone app. Never point it at port 7001: that's the FamilyFi website, and it would put the website and its sign-in page on your tailnet.

> **Use Serve, never Funnel.** Funnel publishes a Tailscale address on the public internet. Never run `tailscale funnel` for this machine, and never set `AllowFunnel` to `true`.

## Turn it on in FamilyFi

1. In FamilyFi, open **Pair Device**.
2. Under **Remote access**, choose **Tailscale**.
3. In **Address**, enter your address exactly, for example `https://familyfi.tail1234.ts.net`. It must start with `https://` and have nothing after the name: no path, no port, no trailing words.
4. Select **Use this address**.

The card now says **Phones reach home at https://familyfi.tail1234.ts.net · Tailscale**, and the status reads **On**. Then [pair your phones](Phone-and-Watch-app#pair-your-phone): select **Pair a phone**, name the phone and scan the code. The code works once and expires after five minutes. Pair while the phone's Tailscale app is connected.

## Check it works

1. On a phone with Tailscale connected, turn Wi-Fi off so it uses mobile data.
2. Open `https://familyfi.tail1234.ts.net` (your address) in the phone's browser. You should see a short page that starts *This is a FamilyFi remote-access address.* The website itself never opens here; that's expected.
3. For a second check, open `https://familyfi.tail1234.ts.net/api/v1/health`. A short JSON reply means FamilyFi is answering.
4. Open the FamilyFi app. It should show your household.

The very first visit can take a few seconds while Tailscale fetches the HTTPS certificate.

## Troubleshooting

**The browser shows "502 Bad Gateway", or the page is blank.**
Tailscale is working, but FamilyFi's remote access port isn't answering. It closes every connection until **Remote access** publishes a route you run. Check that **Tailscale** is chosen on **Pair Device** and the card says **Phones reach home at** your address. If you just switched, wait a few seconds and try again. Also check that FamilyFi itself is running: `docker compose ps`.

**The address doesn't load at all, or the name can't be found.**
- Is the phone's Tailscale app connected, and signed in to the same tailnet?
- Is **MagicDNS** on? Without it, `.ts.net` names don't resolve.
- Does **familyfi** show as connected on the **Machines** page? If not, read the container's log: `docker compose logs tailscale`.

**The browser warns about the certificate, or the log says it can't issue TLS certificates.**
**HTTPS Certificates** isn't turned on for your tailnet. Turn it on under **DNS** in the admin console, then run `docker compose restart tailscale`.

**The machine is called `familyfi-1`, not `familyfi`.**
Your tailnet already had a machine named `familyfi`, often an earlier try. Delete the old one on the **Machines** page and rename this one to `familyfi`, or use the address Tailscale shows. Whatever it is called, the address you enter in FamilyFi must match exactly.

**Every restart adds a new machine.**
The state volume isn't kept. Check that `TS_STATE_DIR` and the `tailscale-state` volume are both in `docker-compose.override.yml` as shown.

**The container stops with an auth key error.**
The key was already used, expired or revoked before the machine first signed in. Generate a new key, replace `TS_AUTHKEY` in `.env`, and run `docker compose up -d`.

**FamilyFi says "Endpoint must be an absolute HTTPS origin."**
The address must start with `https://` and stop after `.ts.net`. Remove any path after it, such as `/api`.

**The app worked at home but not away.**
The phone's Tailscale app was probably off. FamilyFi's address only works while Tailscale is connected. On iPhone, you can turn on Tailscale's **VPN On Demand** so it reconnects by itself.

**Apple Watch can't reach home on its own.**
Tailscale has no Apple Watch app, so a Watch away from its iPhone may not reach a `.ts.net` address. If your Watch needs to reach home by itself, consider **Cloudflare** instead.

**"Pair a phone" is greyed out.**
No route is published. Finish [Turn it on in FamilyFi](#turn-it-on-in-familyfi) first.

## Switching away or turning it off

Switching is one step. On **Pair Device → Remote access**, choose another option, or **Off**. FamilyFi publishes only one route at a time, so the Tailscale address stops working for the app as soon as you switch. If phones paired through it, FamilyFi asks first. They pick up the new address the next time they reach FamilyFi; a phone that can't should be paired again.

What's left behind:

- **In FamilyFi**, the Tailscale address stays saved. To use it again, choose **Tailscale** and select **Use this route**. Select **Edit** to change it.
- **On your computer**, the Tailscale container keeps running, but it gets no answer from FamilyFi. To remove it, run `docker compose rm -sf tailscale`, delete `docker-compose.override.yml` (or just the `tailscale` service in it) and the `tailscale` folder, remove `TS_AUTHKEY` from `.env`, and run `docker volume ls` to find and remove the `tailscale-state` volume.
- **In Tailscale**, the **familyfi** machine stays on the **Machines** page until you remove it there. Revoke the auth key under **Settings → Keys** if it is still valid.

FamilyFi's built-in updater only updates FamilyFi. To update the Tailscale container, run `docker compose pull tailscale && docker compose up -d`.

## How it's protected

- Only devices signed in to your tailnet can reach the address. With Serve and no Funnel, it isn't on the internet at all.
- Tailscale points only at the remote access port, which passes the app's own requests (`/api/v1/…`) and nothing else. The FamilyFi website and its sign-in page stay on your home network.
- Cookies are removed, and nobody can sign in with a password through it. Only a phone you paired can get in, and pairing needs a five-minute, single-use code from **Pair Device**.
- The port answers nothing until you publish this route, and stops answering when you switch to another.
- The public demo doesn't let you change remote access.


---

**All remote access options:** [Quick tunnel](Remote-access-Quick-tunnel) · [Cloudflare (Automatic)](Remote-access-Cloudflare-Automatic) · [Cloudflare Tunnel you run (Advanced)](Remote-access-Cloudflare-Tunnel) · [Tailscale](Remote-access-Tailscale) · [My domain](Remote-access-home-network) · back to [Phone and Watch app](Phone-and-Watch-app)
