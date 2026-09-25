# Remote access: Tailscale

Phones in your tailnet reach FamilyFi at `https://familyfi.<your-tailnet>.ts.net`, with a
certificate the iPhone already trusts. Your tailnet is private, like a VPN, so this serves the whole
app: the web UI works from anywhere in the tailnet too. It never touches the public internet: use
**Serve, never Funnel**, which would publish the household service.

Tailscale runs as a sidecar container next to FamilyFi's `app` service.

## 1. Prepare your tailnet

In the Tailscale admin console:

1. Turn on **MagicDNS** and **HTTPS certificates** (DNS settings).
2. Create an auth key (Settings → Keys). Put it in `.env` as `TAILSCALE_AUTHKEY`.

## 2. Add the sidecar

Create `docker/tailscale/serve.json`:

```json
{
  "TCP": { "443": { "HTTPS": true } },
  "Web": {
    "${TS_CERT_DOMAIN}:443": { "Handlers": { "/": { "Proxy": "http://app:7001" } } }
  }
}
```

`${TS_CERT_DOMAIN}` is filled in by the Tailscale container itself; leave it as written.

Add the service to `docker/docker-compose.yml` (or an override file next to it):

```yaml
  tailscale:
    image: tailscale/tailscale:stable
    restart: unless-stopped
    hostname: familyfi
    environment:
      TS_AUTHKEY: ${TAILSCALE_AUTHKEY:?Set TAILSCALE_AUTHKEY in .env}
      TS_STATE_DIR: /var/lib/tailscale
      TS_SERVE_CONFIG: /config/serve.json
    volumes:
      - familyfi-tailscale:/var/lib/tailscale
      - ./tailscale:/config:ro
    cap_add:
      - net_admin
      - net_raw
    depends_on:
      - app
```

and `familyfi-tailscale:` under `volumes:`. Pin image tags rather than `latest` if you want
upgrades only when you choose them. Start it with `make docker-up` (or `docker compose up -d`).

## 3. Tell FamilyFi, then pair

1. In FamilyFi, open **Pair Device**. Under **Remote access**, choose **My domain → Tailscale**.
2. Enter `https://familyfi.<your-tailnet>.ts.net` and **Use this address**. It is now the one route
   phones get, and every other route is turned off.
3. Install the Tailscale app on each phone, signed in to the same tailnet.
4. **Pair a phone**, and scan the QR with the FamilyFi app.

You can switch to another option under Remote access at any time. This route stays saved, so
switching back needs no retyping.
