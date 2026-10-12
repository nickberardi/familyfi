# Remote access with your own domain

**My domain** is for households that publish an HTTPS address themselves. You run the part that faces the internet (a reverse proxy, or a VPN plus a proxy), point it at FamilyFi, and type its address into FamilyFi. The app on your phones then uses that address. FamilyFi doesn't manage your proxy, VPN, domain or certificate. That part is yours.

**Pick this if:**

- you already run a reverse proxy at home, such as Nginx Proxy Manager, Traefik or Caddy, or
- you want your own domain without using Cloudflare, or
- your phones already connect home over a VPN.

**Not for you if:**

- you'd rather not open ports on your router or look after a certificate. Use [Cloudflare Tunnel](Remote-access-Cloudflare-Tunnel) or [Tailscale](Remote-access-Tailscale) instead, or **Cloudflare → Automatic** on [Pair Device](Phone-and-Watch-app#choose-how-your-phone-reaches-home).
- your internet provider uses CGNAT (see [Check for CGNAT](#check-for-cgnat-first)). Port forwarding can't work then, so use Tailscale or Cloudflare.

## The one rule: point it at port 7002

Whatever you set up, point it at FamilyFi's **remote access port**, **7002**:

- from a container next to FamilyFi (in the same Compose file): `http://app:7002`
- from your router or a proxy on another computer: `http://<FamilyFi computer's IP>:7002`

That port only answers the phone app. **Never point anything at port 7001.** That's the FamilyFi website, and forwarding it would put the admin sign-in page on the internet.

Port 7002 answers nothing at all until you finish [Turn it on in FamilyFi](#turn-it-on-in-familyfi). If you test it before then, it looks dead. That's expected.

## What you need

- FamilyFi [installed](Install) with Docker Compose.
- An HTTPS address for FamilyFi, such as `https://familyfi.example.com`. The phone app only accepts HTTPS.
- One of these:
  - **Reverse proxy with port forwarding:** a domain name, a DNS record pointing at your home, and port forwards on your UniFi gateway. [Option 1](#option-1-a-caddy-reverse-proxy-next-to-familyfi).
  - **A proxy you already run:** [Option 2](#option-2-a-reverse-proxy-you-already-run).
  - **A VPN** your phones use to reach home: [Option 3](#option-3-a-vpn).

### Check for CGNAT first

Port forwarding only works if your home has its own public IP address. Some providers share one address between many homes. This is called CGNAT, and it is common on mobile (4G/5G) home internet, Starlink and some fibre providers.

To check:

1. In UniFi Network, look up your gateway's internet (WAN) IP address.
2. On a computer at home, visit a site such as [whatismyip.com](https://www.whatismyip.com).

If the two addresses differ, or the WAN address starts with `100.64` to `100.127`, you are behind CGNAT. Use [Tailscale](Remote-access-Tailscale) or [Cloudflare Tunnel](Remote-access-Cloudflare-Tunnel), which work without port forwarding. Some providers will give you a public IP on request.

### If your home IP address changes

Most home connections get a new public IP address from time to time. Your DNS record then points at the old one, and phones can't connect. Use dynamic DNS (DDNS) to keep it up to date:

- UniFi gateways have a built-in **Dynamic DNS** setting for the internet (WAN) connection, which works with common DDNS services.
- Or use your DNS provider's own updater, or a DDNS container.

Set this up before you rely on the address.

## Option 1: a Caddy reverse proxy next to FamilyFi

[Caddy](https://caddyserver.com) gets and renews a free, trusted HTTPS certificate for your domain by itself. For that to work, your domain must point at your home, and ports 80 and 443 must reach Caddy from the internet.

### 1. Point your domain at your home

At your DNS provider, create an **A record** for the name you want (for example `familyfi.example.com`) with your home's public IP address. If your IP changes, set up [dynamic DNS](#if-your-home-ip-address-changes).

### 2. Forward ports 80 and 443 on your UniFi gateway

In UniFi Network, open **Settings** and find **Port Forwarding**. On recent versions it is under **Policy Engine**. The menu has moved between versions, so if you don't see it there, search the settings for "Port Forwarding". Create two rules:

| Name | Port (outside) | Forward to IP | Forward port | Protocol |
| --- | --- | --- | --- | --- |
| Caddy HTTP | 80 | the FamilyFi computer's IP | 80 | TCP |
| Caddy HTTPS | 443 | the FamilyFi computer's IP | 443 | TCP |

Give the FamilyFi computer a fixed IP (a DHCP reservation, called **Fixed IP Address** on the client in UniFi Network) so the forwards keep working.

Caddy needs port 80 to prove to the certificate authority that you own the domain, and to redirect plain `http://` visits to HTTPS. Don't forward 7001 or 7002: only Caddy faces the internet.

### 3. Add Caddy next to FamilyFi

In the folder where you [installed](Install) FamilyFi:

1. Create a folder named `caddy`, and in it a file named `Caddyfile`. Use your own domain:

   ```
   familyfi.example.com {
       reverse_proxy app:7002
   }
   ```

2. Create `docker-compose.override.yml` next to `docker-compose.yml`. Docker Compose reads it automatically, and it survives when you replace `docker-compose.yml` with a newer one. If you already have this file (for example for Tailscale), add the `caddy` service and the two volumes to it.

   ```yaml
   services:
     caddy:
       image: caddy:2.11
       restart: unless-stopped
       ports:
         - "80:80"
         - "443:443"
       volumes:
         - ./caddy:/etc/caddy:ro
         - caddy-data:/data
         - caddy-config:/config
       depends_on:
         - app

   volumes:
     caddy-data:
     caddy-config:
   ```

   The `caddy-data` volume holds your certificate. Keep it, or Caddy has to request a new certificate every time it starts.

3. Start it:

   ```bash
   docker compose up -d
   ```

4. Check that Caddy got its certificate:

   ```bash
   docker compose logs caddy
   ```

   Look for a line saying the certificate was obtained. If it says something failed, check the DNS record and the port forwards.

Ports 80 and 443 must be free on the FamilyFi computer. If something else already uses them, you probably already run a proxy: use Option 2 instead.

FamilyFi's automatic updates only update FamilyFi itself, not Caddy. To update Caddy, change the version in `docker-compose.override.yml` if needed, then run `docker compose pull caddy && docker compose up -d caddy`.

## Option 2: a reverse proxy you already run

In Nginx Proxy Manager, Traefik, Caddy or any other reverse proxy, add a site for your address that forwards to FamilyFi's remote access port:

- on the same Docker network as FamilyFi: `http://app:7002`
- anywhere else: `http://<FamilyFi computer's IP>:7002`

Give the site an HTTPS certificate in the usual way for your proxy, for example from Let's Encrypt.

Leave out anything that adds a login page in front of the site (such as an "access list" or forward-auth). The phone app can't get past a login page. FamilyFi already turns away anything that isn't a paired phone.

## Option 3: a VPN

If your phones connect home over a VPN, such as the VPN server built into your UniFi gateway, the app can reach FamilyFi while the VPN is on. Nothing is opened to the internet. The phone needs the VPN turned on to use FamilyFi when away.

The app still needs **HTTPS**, and port 7002 is plain HTTP, so you need a small proxy with a certificate in front of it. Inside your home, a self-signed certificate is the simplest choice: FamilyFi lets you pin it, so phones trust exactly that one certificate.

1. In the FamilyFi folder, create a folder named `caddy`, and in it make a certificate that lasts ten years. Replace `192.168.1.10` with the FamilyFi computer's IP address:

   ```bash
   mkdir -p caddy
   openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
     -days 3650 -subj "/CN=familyfi" -addext "subjectAltName=IP:192.168.1.10" \
     -keyout caddy/key.pem -out caddy/cert.pem
   ```

2. Create `caddy/Caddyfile`:

   ```
   https://192.168.1.10:8443 {
       tls /etc/caddy/cert.pem /etc/caddy/key.pem
       reverse_proxy app:7002
   }
   ```

3. Create `docker-compose.override.yml` as in [Option 1](#3-add-caddy-next-to-familyfi), but publish only port 8443:

   ```yaml
   services:
     caddy:
       image: caddy:2.11
       restart: unless-stopped
       ports:
         - "8443:8443"
       volumes:
         - ./caddy:/etc/caddy:ro
         - caddy-data:/data
         - caddy-config:/config
       depends_on:
         - app

   volumes:
     caddy-data:
     caddy-config:
   ```

4. Run `docker compose up -d`.

Your address is `https://192.168.1.10:8443`. Don't forward any port on your router for this option: the VPN carries the traffic.

Use your own certificate like this, not Caddy's built-in `tls internal` certificates. Caddy replaces those every few hours with a new key, which would break the pin each time.

## Turn it on in FamilyFi

1. In FamilyFi, open **Pair Device** (under **System**).
2. Under **Remote access**, choose **My domain**.
3. In **Address**, type your HTTPS address, for example `https://familyfi.example.com` or `https://192.168.1.10:8443`. Use only the address: `https://`, the name or IP, and a port if it isn't 443. No path, and no slash or anything after it.
4. Under **Certificate**, choose how phones trust it:
   - **Trusted by iPhone** for a certificate from a public authority, such as the one Caddy or Let's Encrypt gets for your domain (Options 1 and 2). This choice applies to Android phones too.
   - **Pin this certificate** for a self-signed certificate (Option 3). Then select **Read certificate from this address**. FamilyFi connects to the address, reads its certificate and fills in **SPKI SHA-256 pin**. Check that the name and expiry date it shows are the ones you expect. If FamilyFi can't reach the address, select **Paste certificate instead**, paste the contents of `cert.pem`, and select **Use this certificate**.
5. Select **Use this address**.

FamilyFi saves the address and publishes it straight away. The saved route shows the address with **Ordinary certificate checks**, or **Pinned** and the start and end of the pin. Below it, **Phones reach home at** shows the address phones now use.

If phones were paired through a different route, FamilyFi asks first. They pick up the new address the next time they reach FamilyFi, and can't use the old one after you switch.

Then [pair your phones](Phone-and-Watch-app#pair-your-phone).

## Check it works

1. On your phone, turn off Wi-Fi (for the VPN option, turn the VPN on instead).
2. Open your address in the phone's browser, for example `https://familyfi.example.com`. You should see:

   > This is a FamilyFi remote-access address.

   That page comes from FamilyFi's remote access port, so the whole path works.
3. For a pinned certificate, select **Check** next to the saved route on **Pair Device**. It should say **Matches the certificate this address serves now.**
4. Pair a phone and open the app away from home.

The status next to **Remote access** says **On** as soon as you publish your address. That means FamilyFi has published it, not that it can be reached from outside. FamilyFi can't see your router or proxy, so always test from outside.

## Troubleshooting

**"Endpoint must be an absolute HTTPS origin."**
The address isn't a plain HTTPS address. Start with `https://`, and remove any path, `?…` or `#…`. `https://familyfi.example.com` is right; `https://familyfi.example.com/api` and `http://familyfi.example.com` are not.

**"A route with this address already exists."**
That address belongs to FamilyFi's own Cloudflare tunnel (**Cloudflare → Automatic**). Use it from there, or choose a different name. (If you type an address you saved earlier under **Tailscale** or **Cloudflare → Advanced**, FamilyFi moves that saved route to **My domain** instead.)

**The browser can't connect at all, or the connection times out.**
- Remote access isn't published yet. Port 7002 closes every connection until you select **Use this address**.
- A port forward is missing or points at the wrong computer.
- Your home IP changed and the DNS record is out of date. Set up [dynamic DNS](#if-your-home-ip-address-changes).
- You are behind [CGNAT](#check-for-cgnat-first). Use Tailscale or Cloudflare.

**The browser shows the FamilyFi sign-in page or website.**
Your proxy or port forward points at 7001. Change it to 7002 straight away: 7001 puts the admin website on the internet.

**The browser shows "Not available through remote access."**
That's FamilyFi answering correctly. The remote access port only passes the app's requests, so any page other than the address itself gives this message.

**Caddy logs say it couldn't get a certificate.**
The certificate authority couldn't reach Caddy. Check that the DNS record points at your current public IP, that ports 80 and 443 are forwarded to the FamilyFi computer, and that you aren't behind CGNAT.

**It works on mobile data but not on home Wi-Fi.**
At home, your domain resolves to your own public IP, and the request has to loop back through the gateway (called NAT loopback or hairpin NAT). If your router doesn't do that, add a local DNS record for the name that points at the FamilyFi computer's home IP.

**"Read certificate from this address" fails: "FamilyFi could not resolve …", "No answer from … within 5 seconds." or "FamilyFi could not complete a TLS handshake with …".**
FamilyFi reads the certificate from inside its own container, so it must be able to reach the address from your home network. Check the address and port, and that the proxy is running. Or select **Paste certificate instead** and paste your `cert.pem`.

**"This certificate is already trusted by devices. Choose Trusted by iPhone instead, so renewals don't break the pin."**
The address has a certificate from a public authority. Choose **Trusted by iPhone**. Pinning it would stop phones each time it renews.

**"This pin differs from the certificate FamilyFi just read. Phones will refuse the route unless the pin matches."**
You changed the pin by hand after reading the certificate. Select **Read certificate from this address** again to put back the correct one.

**Check says "Doesn't match — this address now serves …".**
The certificate was replaced with a new key. Phones refuse the route until you update the pin. Select **Edit**, then **Read certificate from this address**, and **Use this address**. Phones pick up the new pin the next time they reach FamilyFi, so update it while they're still at home, or keep the old key when you renew.

**Check says "Couldn't check from FamilyFi: …".**
FamilyFi couldn't reach the address to look. That doesn't mean the pin is wrong or right. See the read errors above.

**Paired phones stopped connecting after I switched routes.**
Phones learn the new address the next time they reach FamilyFi. A phone that can't reach the old address any more can't learn the new one. Open the app on your home Wi-Fi, or [re-pair it](Phone-and-Watch-app#pair-your-phone).

**"Pair a phone" is greyed out.**
Remote access is **Off**. Publish an address first.

## Switching away or turning it off

- **Switch to another choice:** pick it under **Remote access**. Only one route is published at a time, and switching is one step.
- **Turn it off:** choose **Off**. Phones can't reach home or pair until you turn a route on again.

Your **My domain** address stays saved either way. To use it again, choose **My domain** and select **Use this route**. **Edit** changes the address or certificate.

FamilyFi doesn't touch anything outside itself. After switching away, remove what you set up if you no longer need it:

- the port forwards on your UniFi gateway,
- the `caddy` service in `docker-compose.override.yml` (then run `docker compose up -d --remove-orphans`), or the site in your existing proxy,
- the DNS record and any dynamic DNS setup.

Remote access can't be changed on the [live demo](https://demo.getfamilyfi.com).

## How it's protected

- Only port 7002 is behind your address. It passes the app's requests and nothing else: the FamilyFi website, its sign-in page and the API reference stay on your home network.
- It closes every connection until you publish a route, so an open port forward reveals nothing before then.
- Nobody can sign in with a password through it. Only phones you paired, with a single-use code that expires after five minutes, can get in. **Revoke** on **Pair Device** signs a lost phone out at once.
- Browser cookies are stripped, so a browser session can't be used through it.
- Phones check the address's certificate: the normal way, or against your pin, accepting only that exact key.
- Paired phones only accept route changes that FamilyFi has signed.


---

**All remote access options:** [Quick tunnel](Remote-access-Quick-tunnel) · [Cloudflare (Automatic)](Remote-access-Cloudflare-Automatic) · [Cloudflare Tunnel you run (Advanced)](Remote-access-Cloudflare-Tunnel) · [Tailscale](Remote-access-Tailscale) · [My domain](Remote-access-home-network) · back to [Phone and Watch app](Phone-and-Watch-app)
