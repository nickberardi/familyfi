# Remote access with your own Cloudflare Tunnel

Most households should use **Cloudflare → Automatic** on Pair Device, where FamilyFi creates and runs the tunnel for you (see [Phone and Watch app](Phone-and-Watch-app#cloudflare--automatic)). This page is for **Cloudflare → Advanced**: a tunnel you create and run yourself, for example to put it behind Cloudflare Access.

## Create the tunnel

1. In the [Cloudflare dashboard](https://one.dash.cloudflare.com), open **Zero Trust → Networks → Tunnels → Create a tunnel**, and choose **Cloudflared**.
2. Copy the tunnel token it shows.
3. Under the tunnel's **Public Hostname**, add your address (for example `familyfi.example.com`) with service **`http://app:7002`**.

> `http://app:7002` is FamilyFi's remote access port, which only answers the phone app. Never point the tunnel at port 7001: that would put the FamilyFi website and its sign-in page on the internet.

## Add the cloudflared container

In the folder where you [installed](Install) FamilyFi:

1. Add the token to `.env`:

   ```bash
   echo "CLOUDFLARE_TUNNEL_TOKEN=eyJ..." >> .env
   ```

2. Create `docker-compose.override.yml` next to `docker-compose.yml` (Docker Compose reads it automatically):

   ```yaml
   services:
     cloudflared:
       image: cloudflare/cloudflared:2026.9.1
       restart: unless-stopped
       command: tunnel --no-autoupdate run
       environment:
         TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN:?Set CLOUDFLARE_TUNNEL_TOKEN in .env}
       depends_on:
         - app
   ```

3. Start it with `docker compose up -d`. The tunnel shows as healthy in Cloudflare.

FamilyFi never sees the tunnel token; it stays in your `.env` and the container.

## Turn it on in FamilyFi

On **Pair Device → Remote access**, choose **Cloudflare → Advanced**, enter `https://familyfi.example.com`, and select **Use this address**. Then [pair your phones](Phone-and-Watch-app#pair-your-phone).

## Optional: Cloudflare Access

Cloudflare Access adds a second lock: Cloudflare turns away any request that doesn't carry a service token, before it reaches your home. A request that gets through still needs a paired phone.

1. In Cloudflare Zero Trust, create a **service token**. Then create a **self-hosted application** for your address with one **Service Auth** policy that includes that token. Turn on **Return 401 response for Service Auth policies**, and add no other policies to this application.
2. On **Pair Device**, edit the Advanced route, tick **Protect with Cloudflare Access**, and paste the token's Client ID and Client Secret.
3. Pair phones as usual. Phones you already paired pick up the token the next time they reach FamilyFi, and Pair Device shows how many have it. Turn the Access policy on once they all do.

**Replacing the token** without cutting anyone off: rotate the secret in Cloudflare with a grace period, paste the new ID and secret on Pair Device, and remove the old one once Pair Device says every active phone has the new token. A phone that missed the whole grace period just needs to be paired again.

**Turning Access off:** select **Turn off Access** on Pair Device first, then remove the application in Cloudflare. The other way round locks out every phone.

More detail: [operations reference](https://github.com/nickberardi/familyfi/blob/main/docs/operations.md#your-own-cloudflare-tunnel-and-cloudflare-access-advanced).
