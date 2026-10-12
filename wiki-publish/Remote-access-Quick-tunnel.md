# Remote access with a Quick tunnel

A **Quick tunnel** is the fastest way to let the FamilyFi app reach home. FamilyFi starts a free Cloudflare quick tunnel itself and gets a random address like `https://some-random-words.trycloudflare.com`. You don't need a Cloudflare account, a domain, a router change or a certificate. The catch: the address changes every time FamilyFi restarts, and Cloudflare offers quick tunnels for trying things out, with no uptime promise.

**Pick this if** you want to try the phone app today, or you need remote access for a short while.

**Not for you if** you want phones to keep working for weeks without attention. FamilyFi restarts when the computer reboots, when Docker restarts, and when you install an update, and each restart gives the tunnel a new address. For a permanent address, use [Cloudflare → Automatic](Remote-access-Cloudflare-Automatic), [Tailscale](Remote-access-Tailscale), [your own Cloudflare Tunnel](Remote-access-Cloudflare-Tunnel) or [My domain](Remote-access-home-network).

## What you need

- FamilyFi [installed](Install) with the standard Docker image. The image already includes `cloudflared`, the program that runs the tunnel; FamilyFi never downloads it.
- A computer that can make ordinary outgoing internet connections. Most home networks allow this already. If you have a strict outbound firewall, `cloudflared` needs port 7844 out (TCP and UDP) and HTTPS out.
- The FamilyFi app on your phone. See [Phone and Watch app](Phone-and-Watch-app).

There is nothing else to set up: no extra container, no `docker-compose.override.yml`, and no port forward. The tunnel runs inside the FamilyFi container and connects outward to Cloudflare. It doesn't use the remote access port 7002, which stays closed.

## Turn it on in FamilyFi

1. On your home network, open FamilyFi and go to **System → Pair Device**.
2. In the **Remote access** card, choose **Quick tunnel**.
3. Wait a few seconds. The status in the card's corner shows **Starting…**, then **On**.
4. When it's on, the card shows **Phones reach home at** `https://….trycloudflare.com` **· Quick tunnel**.
5. Select **Pair a phone**, give the phone a name, and scan the QR code with the FamilyFi app. If you're pairing the phone you're reading this on, copy the pairing code and paste it into the app instead. The code works once and expires after five minutes.

The pairing code already contains the tunnel address, so you never type it.

## Check it works

1. Copy the address after **Phones reach home at** and open it in a browser. You should see a short note: "This is a FamilyFi remote-access address." That means the tunnel reaches FamilyFi.
2. On your phone, turn off Wi-Fi so it uses mobile data, and open the FamilyFi app. It should load your household.
3. Back on **Pair Device**, the phone appears under **Paired devices**, with the tunnel address it reaches home through.

## Troubleshooting

**Quick tunnel can't be selected (greyed out).**
FamilyFi can't find `cloudflared`. When this happens the card says "This server doesn't have cloudflared. The FamilyFi Docker image includes it." Make sure you're running the official FamilyFi image from the [Install](Install) page, not a build of your own. On the hosted demo, remote access is always unavailable.

**The status says Not connected, with "The tunnel stopped. Retrying."**
`cloudflared` couldn't stay connected to Cloudflare. FamilyFi retries on its own, waiting a little longer each time, up to a minute. Check that the computer has internet access and that a firewall isn't blocking outgoing port 7844. Any error `cloudflared` reports appears in red in the card. For more detail, run `docker compose logs app` in your FamilyFi folder.

**The status says Not connected: "Another FamilyFi process using this database is running remote access."**
Two copies of FamilyFi are using the same database, for example an old container still running next to a new one. Only one can run the tunnel. Stop the extra copy; this one takes over within about a minute.

**The status stays on Starting… and no address appears.**
Cloudflare hasn't given the tunnel an address yet. Quick tunnels have no uptime promise and are sometimes slow or unavailable. Wait a minute. If it doesn't come up, choose **Off** and then **Quick tunnel** again, or switch to a permanent option.

**Pair a phone isn't offered, and the page says "Turn on remote access, then pair a phone."**
The tunnel isn't on yet. FamilyFi only hands out a pairing code once the address actually works. Wait for **On**.

**After a restart or an update, the app says "Can't reach FamilyFi".**
This is the quick tunnel's main limitation. The restart gave the tunnel a new address, and the phone only knows the old one, which no longer answers. FamilyFi starts a new quick tunnel by itself after a restart, so check **Pair Device** for the new address. A paired phone learns a new address the next time it manages to reach FamilyFi, but with a quick tunnel alone it has no other way in. To get it working again, **Revoke** the phone under **Paired devices**, then open **Show revoked**, select **Re-pair** and scan the new code. To stop this happening, switch to a permanent option.

**Opening the tunnel address in a browser doesn't show the FamilyFi website.**
That's intentional. The tunnel only carries the phone app's requests. The website and its sign-in page stay on your home network.

**The app is slow or some requests fail with a busy error.**
Cloudflare limits each quick tunnel to 200 requests at once. A household rarely gets close, but if it happens, use a permanent option.

## Switching away or turning it off

Choose another option under **Remote access**, or **Off**. Only one route is published at a time, so switching turns the quick tunnel off in the same step.

- If phones paired through the quick tunnel, FamilyFi asks first. They pick up the new address the next time they reach FamilyFi, and can't use the old one once you switch. Switch while the phones can still reach FamilyFi, and open the app on each one afterwards so it learns the new address.
- **Off** publishes nothing: phones can't reach home or pair.
- Nothing is left behind in Cloudflare. There's no account, DNS record or saved tunnel to clean up. FamilyFi keeps one quick tunnel entry, so choosing **Quick tunnel** again later uses the same entry. The address will still be new.

## How it's protected

- The tunnel only reaches a phone-only gateway inside FamilyFi. It passes the app's own requests (`/api/v1/…`) and nothing else, and it drops browser cookies.
- The FamilyFi website and its sign-in page can't be reached through the tunnel. Nobody can sign in with a password from outside; only a phone you paired can get in.
- Pairing codes work once and expire after five minutes. **Revoke** signs a lost phone out at once.
- `cloudflared` is a fixed version, checked when the image is built, and runs without FamilyFi's secrets such as the database password or encryption key.
- The address is random but public: anyone who learns it can reach the gateway, though not your household data without a paired phone.


---

**All remote access options:** [Quick tunnel](Remote-access-Quick-tunnel) · [Cloudflare (Automatic)](Remote-access-Cloudflare-Automatic) · [Cloudflare Tunnel you run (Advanced)](Remote-access-Cloudflare-Tunnel) · [Tailscale](Remote-access-Tailscale) · [My domain](Remote-access-home-network) · back to [Phone and Watch app](Phone-and-Watch-app)
