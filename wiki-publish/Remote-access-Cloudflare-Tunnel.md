# Remote access with your own Cloudflare Tunnel

With **Cloudflare → Advanced**, you run a Cloudflare Tunnel yourself, in a small `cloudflared` container next to FamilyFi. The FamilyFi app on your phones reaches home at your own address, such as `https://familyfi.example.com`. You can also put Cloudflare Access in front of it, so Cloudflare turns away anyone who isn't one of your phones.

**Pick this if** you already manage tunnels in your Cloudflare account, or you want Cloudflare Access as an extra lock.

**Not for you if** you just want a permanent address with no containers to look after. Use **Cloudflare → Automatic** instead: FamilyFi creates and runs the tunnel for you (see [Phone and Watch app](Remote-access-Cloudflare-Automatic)). To try the app today, **Quick tunnel** needs nothing at all.

## What you need

- FamilyFi [installed](Install) with Docker Compose.
- A Cloudflare account with a domain on it, such as `example.com`. A free plan is enough.
- A spare name on that domain for FamilyFi, such as `familyfi.example.com`. It must not already have a DNS record.
- About 15 minutes. Add 10 more for Cloudflare Access.

## Set it up

### 1. Create the tunnel in Cloudflare

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/?to=/:account/tunnels), go to **Networking → Tunnels** and select **Create a tunnel**.
2. Give it a name, such as `familyfi`, and select **Create Tunnel**.
3. When Cloudflare asks where you'll run it, choose **Docker**. It shows a command ending in `--token eyJ…`. Copy only the long token after `--token`. Don't run the command. You'll run the tunnel with Docker Compose instead.

### 2. Add the cloudflared container

In the folder where you installed FamilyFi (the one with `docker-compose.yml` and `.env`):

1. Add the token to `.env`:

   ```bash
   echo "CLOUDFLARE_TUNNEL_TOKEN=eyJ..." >> .env
   ```

2. Create a file named `docker-compose.override.yml` next to `docker-compose.yml`. Docker Compose reads it automatically, and it stays put when you replace `docker-compose.yml` with a newer one.

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

   The image is pinned to one `cloudflared` release, so it changes only when you change it. To upgrade, edit the version and run `docker compose up -d` again. FamilyFi's updater never touches this container.

3. Start it:

   ```bash
   docker compose up -d
   ```

4. Back in Cloudflare, the tunnel shows **Healthy** after a few seconds. If the setup page is still open, select **Continue**.

### 3. Point your address at FamilyFi

1. In **Networking → Tunnels**, select your tunnel.
2. On the **Routes** tab, select **Add route**, then **Published application**.
3. Enter the subdomain (for example `familyfi`) and pick your **Domain**. Leave the path empty.
4. In **Service URL**, enter exactly:

   ```
   http://app:7002
   ```

5. Select **Add route**. Cloudflare creates the DNS record for you.

> `http://app:7002` is FamilyFi's **remote access port**. It only lets through what the phone app needs. Never use port 7001: that is the FamilyFi website, and it would put your admin sign-in page on the internet. `app` is the FamilyFi container's name inside Docker Compose; don't use `localhost`, which means the cloudflared container itself.

Cloudflare provides the HTTPS certificate, so there's nothing else to set up. FamilyFi never sees the tunnel token: it stays in your `.env` and the cloudflared container.

## Turn it on in FamilyFi

1. Open FamilyFi in a browser at home and go to **System → Pair Device**.
2. Under **Remote access**, choose **Cloudflare**, then **Advanced**.
3. In **Address**, enter `https://familyfi.example.com`: `https://`, your name, and nothing after it. As the page says, it's an HTTPS origin only, with no path.
4. Leave **Protect with Cloudflare Access** unticked for now.
5. Select **Use this address**.

The card now shows your address with "No Cloudflare Access: the tunnel alone guards this address", and the status at the top says **On**. Then [pair your phones](Phone-and-Watch-app#pair-your-phone).

Only one route is published at a time. Choosing Advanced turns off whatever was on before, such as a quick tunnel. Phones already paired learn the new address the next time they reach FamilyFi.

## Check it works

1. On a phone with Wi-Fi turned off, open `https://familyfi.example.com` in the browser. You should see a short note: "This is a FamilyFi remote-access address." That means the tunnel reaches FamilyFi. You should **not** see the FamilyFi sign-in page.
2. On **Pair Device**, the line under the picker says "Phones reach home at https://familyfi.example.com · Cloudflare Tunnel".
3. Pair a phone, turn off its Wi-Fi, and open the FamilyFi app. Your household should load.

FamilyFi can't see inside your Cloudflare account, so **On** only means the route is published. Cloudflare's **Healthy** status tells you the tunnel itself is up.

## Optional: add Cloudflare Access

Cloudflare Access adds a second lock in front of FamilyFi. Cloudflare turns away any request that doesn't carry your **service token**, before it reaches your home. A request that gets through still needs a paired phone, as it does without Access. FamilyFi gives the token to your phones and Watches for you, in the pairing code and in the signed settings paired phones download. You never type it on a phone.

The order matters. Phones must have the token **before** Cloudflare starts asking for it, or it turns them away.

### 1. Create a service token

1. In the Cloudflare dashboard, go to **Zero Trust → Access controls → Service credentials → Service Tokens**.
2. Select **Create Service Token**, name it (for example `familyfi-phones`), and choose a **Service Token Duration**. Longer means fewer renewals.
3. Select **Generate token**. Copy the **Client ID** and the **Client Secret**. Cloudflare shows the secret only this once.

### 2. Give the token to FamilyFi

1. On **Pair Device → Remote access → Cloudflare → Advanced**, select **Edit** on your address.
2. Tick **Protect with Cloudflare Access**.
3. Paste the **Client ID** and **Client Secret** exactly as Cloudflare shows them.
4. Select **Use this address**.

The card now shows a **Cloudflare Access** badge, the token's number (**Token 1**), and how many phones have it, for example "1 of 2 active phones have the token. Waiting for Emma's iPhone. Cloudflare turns them away until then."

Paired phones and Watches pick up the token the next time they reach FamilyFi. Opening the app on each one is enough. Phones you pair from now on get it in the pairing code. Wait until the card says **Every active phone has the token.** (or **No active phones yet.**) before the next step. A device counts as active if it was used in the last 30 days and isn't revoked.

### 3. Create the Access application

1. In Cloudflare, go to **Zero Trust → Access controls → Applications** and select **Create new application**.
2. Select **Self-hosted and private**, then **Add public hostname**, and choose the same name and **Domain** as your tunnel route.
3. Under **Access policies**, create a new policy:
   - **Action**: **Service Auth**
   - **Include**: **Service Token**, and pick the token you created.

   Add no other policies to this application, and no Allow policies. The phone app can't use a login page.
4. On the **Additional settings** tab, turn on **401 Response for Service Auth policies**. The app then gets a plain refusal instead of Cloudflare's login page.
5. Select **Create**.

Access is now on. Check it: open `https://familyfi.example.com` in a phone browser. You should now get an error (401) instead of the FamilyFi note, while the app keeps working.

### Replace the token

Replace the token if it may have leaked, for example after a photo of a pairing code was shared. Phones don't lose access while you do it.

1. In **Service Tokens**, select the three dots next to your token, then **Rotate secret**. In **Keep the current secret valid for**, choose a grace period (up to 30 days), then select **Rotate**. Copy the new **Client Secret**. The Client ID doesn't change.
2. On **Pair Device**, select **Edit**, and paste the Client ID and the new Client Secret. Both are needed. (Left blank, both keep the current token.) Select **Use this address**. The token's number goes up by one.
3. The card says which phones are still waiting, and "Keep the old token in Cloudflare until then." When it says **Every active phone has the new token. You can remove the old one in Cloudflare.**, you're done. The old secret stops working when the grace period ends.

Instead of rotating, you can also create a second service token, add it to the same policy, paste it into FamilyFi, and delete the first token once every phone has the new one.

A phone that wasn't used during the whole grace period still has the old secret, so Cloudflare turns it away. Select **Re-pair** for it on **Pair Device** and scan the new code. Nothing else about the phone changes.

**Token about to expire?** You don't need to replace it. In **Service Tokens**, select **Refresh** to extend it by a year, or **Edit** to pick a new duration. The secret stays the same, so there's nothing to change in FamilyFi.

### Turn Access off

Do it in this order:

1. On **Pair Device**, select **Turn off Access** on your address and confirm. Phones stop sending the token.
2. Then, in Cloudflare, delete the Access application.

The other way round, Cloudflare turns every phone away until it reaches FamilyFi another way. (Unticking **Protect with Cloudflare Access** under **Edit** and saving does the same as **Turn off Access**.)

## Troubleshooting

**The address shows FamilyFi's sign-in page.** The route points at port 7001. Change the **Service URL** to `http://app:7002` right away.

**Cloudflare shows a "Bad gateway" (502) error page.** The tunnel is running but FamilyFi isn't answering it:
- Remote access isn't set to your Advanced address. The remote access port answers nothing until **Pair Device** publishes it. Check that the status says **On** and the address is listed under "Phones reach home at".
- The **Service URL** is wrong. It must be `http://app:7002`, not `https://`, not `localhost`, not 7001.
- FamilyFi is stopped or starting. Run `docker compose ps` and check that `app` is running.

**Cloudflare shows error 1033, or the tunnel isn't Healthy.** The cloudflared container isn't connected. Run `docker compose logs cloudflared`. A wrong or incomplete token is the usual cause: copy it again into `.env`, then run `docker compose up -d`. If the server's firewall blocks outgoing traffic, cloudflared needs port 7844 to Cloudflare.

**"Set CLOUDFLARE_TUNNEL_TOKEN in .env" when starting.** The token line is missing from `.env`, or `.env` is in a different folder from the compose files.

**"Endpoint must be an absolute HTTPS origin."** The address must start with `https://` and have nothing after the name, not even a `/path`.

**"A route with this address already exists."** You set up the same name with **Cloudflare → Automatic** before. Choose **Cloudflare → Automatic**, select **Forget domain**, and remove its tunnel and DNS record in Cloudflare. Then add the Advanced address again. Also, Cloudflare won't add a route for a name that already has a DNS record; delete the old record first.

**Use this address is greyed out.** **Protect with Cloudflare Access** is ticked, but only one of Client ID and Client Secret is filled in. Paste both, or (when editing) leave both blank to keep the current token.

**"The Client ID and Client Secret must be pasted exactly as Cloudflare shows them, with no spaces."** A space or line break was copied too. Paste each value again.

**Phones stopped working after you turned Access on.** Some phones didn't have the token yet. The card lists the ones it's waiting for. Either delete the Access application in Cloudflare until they've opened the app, or **Re-pair** them.

**The app gets a login page, or phones fail with Access on, though the card says they have the token.** The Access application has more than the one **Service Auth** policy, or the token in the policy isn't the one in FamilyFi. Check the policy, and turn on **401 Response for Service Auth policies**.

**Phones can't connect after you switched to Advanced from another choice.** A phone learns the new address the next time it reaches FamilyFi. If its old route is gone, open the app once at home, or **Re-pair** it.

**You changed `FAMILYFI_ENCRYPTION_KEY`.** FamilyFi can no longer read the stored service token, so phones stop receiving it. Paste the token again under **Edit**.

## Switching away or turning it off

Choose another option under **Remote access**, or **Off**. Switching is one step. If phones paired through your address, FamilyFi asks first: they pick up the new address the next time they reach FamilyFi, and can't use this one once you switch.

What's left behind:

- **In FamilyFi**, your address and its Access token stay saved. To come back, choose **Cloudflare → Advanced** and select **Use this route**. Nothing to retype.
- **The remote access port** closes again as soon as nothing you run is published. Your tunnel still exists but reaches nothing, so the address shows a Cloudflare error.
- **The cloudflared container** keeps running until you remove it. To stop it for good, delete the `cloudflared` service from `docker-compose.override.yml` (or the whole file, if that was all it held), then run `docker compose up -d --remove-orphans`. Remove the `CLOUDFLARE_TUNNEL_TOKEN` line from `.env`.
- **In Cloudflare**, the tunnel, its DNS record, and any Access application and service token stay until you delete them there.

## How it's protected

- The tunnel reaches only FamilyFi's remote access port. It passes the app's own requests (`/api/v1/…`) and nothing else. The FamilyFi website and its sign-in page stay on your home network.
- Cookies are removed, and nobody can sign in with a password through it. Only a phone you paired gets in. A pairing code works once and expires after five minutes.
- The port answers nothing at all until **Pair Device** publishes your address.
- With Access on, Cloudflare stops strangers before they reach your home. The service token is stored encrypted in FamilyFi and is given only to phones and Watches; it never appears in the website or FamilyFi's logs. FamilyFi strips it before the request reaches the app. Treat it as a shared key: anyone who sees a pairing code could copy it, so replace it if one is shared.
- The tunnel token stays in your `.env`. FamilyFi never has it.
- Remote access settings are locked in the public demo.


---

**All remote access options:** [Quick tunnel](Remote-access-Quick-tunnel) · [Cloudflare (Automatic)](Remote-access-Cloudflare-Automatic) · [Cloudflare Tunnel you run (Advanced)](Remote-access-Cloudflare-Tunnel) · [Tailscale](Remote-access-Tailscale) · [My domain](Remote-access-home-network) · back to [Phone and Watch app](Phone-and-Watch-app)
