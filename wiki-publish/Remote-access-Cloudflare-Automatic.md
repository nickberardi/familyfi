# Remote access with Cloudflare (Automatic)

With **Cloudflare → Automatic**, FamilyFi gives your phones a permanent address, such as `https://familyfi.example.com`, on a domain you keep in Cloudflare. You sign in to Cloudflare from FamilyFi once. FamilyFi then creates a Cloudflare Tunnel and its DNS record, and runs the tunnel itself from inside its own container. There is no extra container to add, no router change and no certificate to manage.

**Pick this if:**

- you have a domain whose DNS is on Cloudflare (a free Cloudflare plan is fine), and
- you want a permanent address with the least setup.

**Not for you if:**

- you don't have a domain on Cloudflare. Try **Quick tunnel** first (nothing to set up, but its address changes when FamilyFi restarts), or use [Tailscale](Remote-access-Tailscale).
- you want to run the tunnel yourself, or put it behind Cloudflare Access. That is **Cloudflare → Advanced**, with its own page: [Remote-access-Cloudflare-Tunnel](Remote-access-Cloudflare-Tunnel).
- you already run your own reverse proxy or VPN. See [My domain](Remote-access-home-network).

## What you need

- FamilyFi [installed](Install) with the standard Docker image. The image already includes Cloudflare's `cloudflared` program.
- A Cloudflare account with your domain added to it, and the domain's nameservers pointed at Cloudflare. ([Cloudflare: add a site](https://developers.cloudflare.com/fundamentals/manage-domains/add-site/))
- A name on that domain for FamilyFi that **doesn't have a DNS record yet**, such as `familyfi.example.com`. FamilyFi creates the record. It never replaces one that already exists.
- Outbound internet from the FamilyFi computer. The tunnel connects out to Cloudflare on port 7844 (TCP and UDP). Most home networks allow this already. Nothing needs to come in, so there's no port to forward. ([Cloudflare: tunnel firewall rules](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/))
- A FamilyFi administrator account, and five minutes.

## Turn it on in FamilyFi

Do this from a browser on your home network. It's easiest on a computer, since you'll switch to a Cloudflare tab and back.

1. Open **Pair Device** (under **System** in the menu).
2. Under **Remote access**, choose **Cloudflare**, then **Automatic**.
3. In **Hostname**, type the name you picked, such as `familyfi.example.com`. Type the name only: no `https://` and no slash.
4. Select **Connect with Cloudflare**. The status changes to **Waiting for Cloudflare…** and, after a moment, a link appears.
5. Select **Open Cloudflare to authorize FamilyFi**. Sign in to Cloudflare if asked, choose the domain your hostname is on, and authorize.
6. Come back to the FamilyFi tab. You don't need to refresh it. The status goes to **Starting…** and then **On**, and the card shows **Phones reach home at https://familyfi.example.com · Cloudflare Tunnel**.

You have five minutes to finish step 5. If you change your mind while FamilyFi is waiting, select **Cancel**.

Now [pair your phones](Phone-and-Watch-app#pair-your-phone): select **Pair a phone** and scan the code in the app. The code expires after five minutes.

### What FamilyFi did in Cloudflare

- Created a tunnel named `familyfi-` followed by your install's ID.
- Created a DNS record for your hostname that points at that tunnel.
- Saved that one tunnel's key in its database, encrypted.
- Deleted the Cloudflare sign-in straight away. That sign-in could manage tunnels and DNS for your whole domain, so FamilyFi doesn't keep it.

Cloudflare provides the HTTPS certificate for your address, so phones trust it with no extra steps.

## Check it works

1. On **Pair Device**, the **Remote access** status reads **On**.
2. On your phone, turn Wi-Fi off and open `https://familyfi.example.com` in the browser. You should see a short note: *"This is a FamilyFi remote-access address. Open the FamilyFi app on a paired phone to use it."* That means the tunnel reaches FamilyFi. The FamilyFi website itself is never shown there, by design.
3. Still on mobile data, open the FamilyFi app on a paired phone. Your household should load.

## Troubleshooting

**The status says "Waiting for Cloudflare…" but no link appears.**
FamilyFi shows *Asking Cloudflare for a sign-in link…* while it waits. If nothing appears after a minute, the FamilyFi computer may not be able to reach Cloudflare. Select **Cancel**, check its internet connection, and try again.

**"Cloudflare sign-in did not finish. Start again and complete the authorization within five minutes."**
The authorization wasn't completed in time, or was declined. Select **Connect with Cloudflare** again and finish in the Cloudflare tab within five minutes.

**"familyfi.example.com already has a DNS record in Cloudflare. Choose another hostname, or remove that record first."**
Something already uses that name. FamilyFi won't overwrite it, and it removes the tunnel it just made. Pick a different name, or delete that record in Cloudflare (**DNS → Records**) if you're sure nothing needs it.

**"Enter a hostname on a domain in your Cloudflare account, like familyfi.example.com."**
The hostname isn't a plain name. Remove any `https://`, slash or spaces. Addresses ending in `trycloudflare.com` or `cfargotunnel.com` aren't allowed.

**"Cloudflare could not create the tunnel." or "Cloudflare could not point … at the tunnel."**
Usually you chose a different domain in Cloudflare from the one your hostname is on. Start again and pick the domain that matches the hostname. Any extra detail from Cloudflare is shown after the message.

**"Another route already uses https://familyfi.example.com. Remove it first, or choose another hostname."**
You already saved that address under another Remote access choice, such as **Cloudflare → Advanced** or **My domain**. Use a different hostname for Automatic.

**The Automatic option is greyed out, or it says "This server doesn't have cloudflared."**
FamilyFi isn't running from the official Docker image. Install it as shown in [Install](Install). On the [live demo](https://demo.getfamilyfi.com), remote access is turned off on purpose.

**The status says "Not connected" with "The tunnel stopped. Retrying."**
The tunnel lost its connection, often because the internet at home dropped. FamilyFi retries on its own, waiting a little longer each time, up to a minute between tries. If it stays like this, check the computer's internet, and that outbound port 7844 isn't blocked.

**"Another FamilyFi process using this database is running remote access. Only one may; this one will take over if that one stops."**
Two copies of FamilyFi share one database, for example an old container still running next to a new one. Stop the extra copy. The remaining one takes over within about a minute.

**"No domain is set up. Connect your domain again."**
FamilyFi has lost the tunnel's key, for example after restoring onto a new install. Enter the hostname and select **Connect with Cloudflare** again. Restores from **Settings → Backup** never include the tunnel key, so this is expected after one.

**Phones show an error after I deleted the tunnel or DNS record in Cloudflare.**
FamilyFi still thinks the tunnel exists. Select **Forget domain**, then set up Automatic again. Phones pick up the address the next time they reach FamilyFi.

**A paired phone can't reach home.**
Check the status on **Pair Device** is **On**. A phone that paired through a different route learns the new address the next time it reaches FamilyFi, for example on your home Wi-Fi. If it can't get home any other way, pair it again: **Revoke** it under **Paired devices**, then select **Re-pair** next to it in the revoked list and scan the new code.

## Switching away, turning it off, and forgetting the domain

Only one Remote access choice is on at a time. Choosing another one turns Automatic off in a single step. If phones paired through your Cloudflare address, FamilyFi asks you to confirm first.

**Switching back** is quick: choose **Cloudflare → Automatic** and select **Turn on**. FamilyFi keeps the tunnel's key, so there's no new Cloudflare sign-in.

**Off** stops the tunnel. Phones can't reach home and new phones can't pair until you turn a choice on again.

**Changing the hostname:** type the new name and select **Connect with Cloudflare**. This needs a new Cloudflare sign-in. Phones can't reach home until the new address is **On**, then they pick it up the next time they connect. FamilyFi replaces its old tunnel, but the DNS record for the old name stays in Cloudflare. Delete it there (**DNS → Records**) when you're done.

**Forget domain** deletes FamilyFi's copy of the tunnel key and turns remote access off. It doesn't touch your Cloudflare account. To clean up there:

1. In the [Cloudflare dashboard](https://dash.cloudflare.com), open **Zero Trust → Networks → Tunnels** and delete the tunnel named `familyfi-…`.
2. Open your domain's **DNS → Records** and delete the record for your FamilyFi hostname. It points at an address ending in `cfargotunnel.com`.

## How it's protected

- **Only the app gets through.** The tunnel reaches a phone-only gate inside FamilyFi, not the website. That gate passes only the app's own requests, drops browser cookies, and turns everything else away. The FamilyFi website and its sign-in page stay on your home network.
- **No passwords from outside.** Nobody can sign in with a password through the tunnel. Only a phone you paired, with a code that works once and expires after five minutes, can get in. **Revoke** on **Pair Device** cuts off a lost phone at once.
- **Nothing open at home.** The tunnel connects out to Cloudflare, so no router port is opened. FamilyFi's remote access port, 7002, stays closed with Automatic.
- **Least access kept.** FamilyFi keeps only the key for its own tunnel, encrypted, and never the Cloudflare sign-in. `cloudflared` runs without access to FamilyFi's other secrets. Household exports never include the tunnel key.
- **One version, checked.** The `cloudflared` in the image is a fixed version, checked when the image is built. FamilyFi never downloads it at runtime.


---

**All remote access options:** [Quick tunnel](Remote-access-Quick-tunnel) · [Cloudflare (Automatic)](Remote-access-Cloudflare-Automatic) · [Cloudflare Tunnel you run (Advanced)](Remote-access-Cloudflare-Tunnel) · [Tailscale](Remote-access-Tailscale) · [My domain](Remote-access-home-network) · back to [Phone and Watch app](Phone-and-Watch-app)
