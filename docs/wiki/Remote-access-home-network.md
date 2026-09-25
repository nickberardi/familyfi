# Remote access: Home network (VPN or reverse proxy)

In FamilyFi, **Pair Device → Remote access → My domain → Home network** is for an HTTPS address on
your own network. The phone might reach that address directly on your Wi-Fi, over your VPN, or
through a reverse proxy. To FamilyFi these are all the same thing: one HTTPS address. This page
covers the two pieces you may need:

1. **An HTTPS address for FamilyFi.** FamilyFi's container serves plain HTTP on port 7001, and the
   iPhone app only talks HTTPS. A small NGINX container next to FamilyFi adds HTTPS.
2. **A way in from outside.** Either a VPN into your home network, or that NGINX published to the
   internet.

Then tell FamilyFi the address, and pair phones through it.

> FamilyFi also has two options that need none of this: **Quick tunnel**, and **My domain →
> Cloudflare Tunnel → Automatic**. Use this page when you already run a VPN or a reverse proxy, or
> want to.

## 1. Add HTTPS with an NGINX sidecar

Add NGINX to `docker/docker-compose.yml` (or an override file next to it), in the same Compose
project as FamilyFi's `app` service:

```yaml
  nginx:
    image: nginx:1.29-alpine
    restart: unless-stopped
    ports:
      - "8443:443"
    volumes:
      - ./nginx/familyfi.conf:/etc/nginx/conf.d/default.conf:ro
      - ./nginx/certs:/etc/nginx/certs:ro
    depends_on:
      - app
```

Pin the image to a version, not `latest`, so an upgrade happens when you choose it.

Create `docker/nginx/familyfi.conf`:

```nginx
server {
  listen 443 ssl;
  http2 on;
  server_name _;

  ssl_certificate     /etc/nginx/certs/familyfi.crt;
  ssl_certificate_key /etc/nginx/certs/familyfi.key;

  location / {
    # Only on your home network or VPN: the whole app, web UI included.
    proxy_pass http://app:7001;
    # Reachable from the internet: the phone-only gateway instead (see below).
    # proxy_pass http://app:7002;

    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

### Which port NGINX points at

| NGINX is reachable from | Point it at | Why |
| --- | --- | --- |
| Your home network and VPN only | `http://app:7001` | The whole app, so the web UI works over HTTPS too |
| The internet (a port forward) | `http://app:7002` | The **phone-only gateway**: it passes `/api/v1/*` only, drops cookies, and signing in needs a paired phone |

**Never publish port 7001 to the internet.** That would put the web admin and its sign-in page
online. To use the gateway, set `FAMILYFI_PHONE_GATEWAY_PORT=7002` in `.env`. Don't add 7002 to the
app's `ports`: NGINX reaches it over the Compose network.

### A certificate

Pick one:

- **Self-signed (simplest).** In FamilyFi, choose **Pin this certificate**: the phone trusts
  exactly this key and nothing else.

  ```sh
  mkdir -p docker/nginx/certs
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 825 \
    -subj "/CN=familyfi.home" \
    -addext "subjectAltName=DNS:familyfi.home,IP:192.168.1.10" \
    -keyout docker/nginx/certs/familyfi.key -out docker/nginx/certs/familyfi.crt
  ```

  Use your server's own LAN IP and name. When the certificate expires, renew it **with the same
  key** (`-key docker/nginx/certs/familyfi.key` in place of `-newkey …`) so the pin keeps
  working. A new key stops phones until you update the pin in FamilyFi. Phones fail closed; they
  never quietly trust a new key.
- **Publicly trusted.** Use a certificate for a name on a domain you own, for example from Let's
  Encrypt with a DNS challenge. In FamilyFi, choose **Trusted by iPhone**. Renewals then need no
  change in FamilyFi.

Run `make docker-up` (or `docker compose up -d`) to start NGINX.

## 2. Reach it from away

- **A VPN into your home network (recommended).** On a UniFi gateway, turn on Teleport or a
  WireGuard VPN server (Settings → VPN), and install the matching app on each phone. With the VPN
  connected, the phone reaches the same LAN address as at home, so nothing is exposed to the
  internet. Point NGINX at `app:7001`.
- **Publish the reverse proxy.** Forward a port on your router to NGINX's 8443, and give it a
  publicly trusted certificate for your domain. Point NGINX at the phone-only gateway, `app:7002`.

## 3. Tell FamilyFi, then pair

1. In FamilyFi, open **Pair Device**. Under **Remote access**, choose **My domain → Home network**.
2. Enter the address phones use, for example `https://192.168.1.10:8443` or
   `https://familyfi.example.com`.
3. For a self-signed certificate, choose **Pin this certificate**, then **Read certificate from
   this address** (or paste the `.crt`). Otherwise leave **Trusted by iPhone**.
4. **Use this address.** It is now the one route phones get, and every other route is turned off.
5. **Pair a phone**, and scan the QR with the FamilyFi app.

**Check** on a pinned route compares the stored pin with the certificate the address serves now.
You can switch to another option under Remote access at any time. This route stays saved, so
switching back needs no retyping.
