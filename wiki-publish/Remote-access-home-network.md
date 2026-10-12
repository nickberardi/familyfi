# Remote access with your own domain

**My domain** is for households that already publish services from home, or want to: you give FamilyFi an HTTPS address that reaches its remote access port, and the app uses it. Two common ways to do it are below.

Whatever you use, point it at FamilyFi's **remote access port**, **7002** on the FamilyFi computer (`http://app:7002` from a container next to FamilyFi). That port only answers the phone app. **Never point anything at port 7001**: that's the FamilyFi website, and it would put the sign-in page on the internet.

## Option 1: a Caddy reverse proxy next to FamilyFi

[Caddy](https://caddyserver.com) gets and renews a free HTTPS certificate for you.

You need:

- a domain name, with a DNS record (for example `familyfi.example.com`) pointing at your home's public IP address, and
- port forwards on your UniFi gateway for ports **80** and **443** to the FamilyFi computer.

In the folder where you [installed](Install) FamilyFi:

1. Create a file named `Caddyfile`:

   ```
   familyfi.example.com {
       reverse_proxy app:7002
   }
   ```

2. Create `docker-compose.override.yml` next to `docker-compose.yml` (Docker Compose reads it automatically):

   ```yaml
   services:
     caddy:
       image: caddy:2
       restart: unless-stopped
       ports:
         - "80:80"
         - "443:443"
       volumes:
         - ./Caddyfile:/etc/caddy/Caddyfile:ro
         - caddy-data:/data
       depends_on:
         - app

   volumes:
     caddy-data:
   ```

3. Start it with `docker compose up -d`.

Already run a reverse proxy, such as Nginx Proxy Manager, Traefik or Caddy elsewhere? Add a site for your address that forwards to `http://<FamilyFi computer>:7002`.

## Option 2: a VPN

If your phones connect home over a VPN, such as UniFi's built-in WireGuard or Teleport, the app can reach FamilyFi while the VPN is on. The phone app still requires **HTTPS**, so you need a reverse proxy with a certificate for an address that resolves inside your network, as above, pointing at port 7002.

## Turn it on in FamilyFi

On **Pair Device → Remote access**, choose **My domain** and enter your `https://` address.

- If your certificate comes from a public authority (Caddy, Let's Encrypt), leave **Ordinary certificate checks** on.
- If it's self-signed, choose **Pin this certificate**, then **Read certificate from this address**. FamilyFi stores its fingerprint, and phones trust exactly that certificate. If you renew it with a new key, update the pin, or phones stop connecting until you do. **Check** compares the pin with what the address serves now.

To check it, open `https://familyfi.example.com/api/v1/health` on your phone over mobile data. A short JSON reply means it works. (The remote access port answers nothing until this step is done.)

Then [pair your phones](Phone-and-Watch-app#pair-your-phone).
