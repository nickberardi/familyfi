# Phone and Watch app

The FamilyFi app lets you see the household and pause or allow internet from your iPhone, iPad, Apple Watch or Android phone. It talks to your own FamilyFi at home; there is no FamilyFi cloud account.

## Get the app

Open **Pair Device** in FamilyFi. It links to the app for iPhone and Android.

## Choose how your phone reaches home

Your phone needs a way to reach FamilyFi when you're away from home. Pick one under **Pair Device → Remote access**. You can switch at any time, and phones pick up the change on their own.

| Choice | Good for | What you set up |
| --- | --- | --- |
| **Quick tunnel** | Trying the app today | Nothing. The address changes when FamilyFi restarts, so it's not meant to stay on. |
| **Cloudflare → Automatic** | Most households with a domain on Cloudflare | Sign in to Cloudflare from FamilyFi once; FamilyFi creates the tunnel. |
| **Tailscale** | Households already using Tailscale | A small container next to FamilyFi. [Guide](Remote-access-Tailscale) |
| **Cloudflare → Advanced** | Running your own tunnel, optionally behind Cloudflare Access | A `cloudflared` container you manage. [Guide](Remote-access-Cloudflare-Tunnel) |
| **My domain** | Your own reverse proxy or VPN | A reverse proxy with an HTTPS certificate. [Guide](Remote-access-home-network) |
| **Off** | Using only the website | Phones can't reach home and can't pair. |

Remote access only ever exposes what the app needs. The FamilyFi website and its sign-in page are never reachable through it, and nobody can sign in with a password from outside: only a phone you paired can get in.

### Cloudflare → Automatic

1. On **Pair Device**, choose **Cloudflare → Automatic** and enter an address on a domain in your Cloudflare account, such as `familyfi.example.com`.
2. Select **Connect with Cloudflare**, open the link it shows, pick the domain, and come back. The page updates on its own.

FamilyFi creates a tunnel and a DNS record for that address, and keeps only that tunnel's own credential. It never overwrites a DNS record that already exists. **Forget domain** turns it off; the tunnel and record stay in your Cloudflare account until you delete them there.

## Pair your phone

1. On **Pair Device**, select **Pair a phone** and give the phone a name, such as *Nick's iPhone*.
2. In the app, scan the QR code. If you're pairing the phone you're reading this on, copy the pairing code instead and paste it into the app.

The code works once and expires after five minutes. Your Apple Watch pairs through your iPhone, with nothing to scan.

**Paired devices** on the same page lists every phone, Watch and agent, when each was last seen, and how it reaches home. **Revoke** signs a lost phone out at once; **Re-pair** gives it a fresh code with its name filled in.

## AI agents

**Connect an agent** on Pair Device gives you a prompt to paste into an AI coding agent such as Claude Code or Codex, so it can read the household and, if you allow it, make changes through FamilyFi's API. Agents connect on your home network only, and never get access to accounts, gateway settings or remote access.
