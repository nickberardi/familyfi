# Phone and Watch app

The FamilyFi app lets you see the household and pause or allow internet from your iPhone, iPad, Apple Watch or Android phone. It talks to your own FamilyFi at home; there is no FamilyFi cloud account.

## Get the app

Open **Pair Device** in FamilyFi. It links to the app for iPhone and Android.

## Choose how your phone reaches home

Your phone needs a way to reach FamilyFi when you're away from home. Pick one under **Pair Device → Remote access**. You can switch at any time, and phones pick up the change on their own.

| Choice | Good for | What you set up |
| --- | --- | --- |
| [**Quick tunnel**](Remote-access-Quick-tunnel) | Trying the app today | Nothing. The address changes whenever FamilyFi restarts, so it's not meant to stay on. |
| [**Cloudflare → Automatic**](Remote-access-Cloudflare-Automatic) | Most households with a domain on Cloudflare | Sign in to Cloudflare from FamilyFi once; FamilyFi creates and runs the tunnel. |
| [**Tailscale**](Remote-access-Tailscale) | Households already using Tailscale | A small container next to FamilyFi; phones join your tailnet. |
| [**Cloudflare → Advanced**](Remote-access-Cloudflare-Tunnel) | Running your own tunnel, optionally behind Cloudflare Access | A `cloudflared` container you manage. |
| [**My domain**](Remote-access-home-network) | Your own reverse proxy or VPN | A reverse proxy with an HTTPS certificate, and usually a port forward. |
| **Off** | Using only the website | Nothing. Phones can't reach home and can't pair. |

Each option has its own page with setup steps, checks and troubleshooting.

Remote access only ever exposes what the app needs. The FamilyFi website and its sign-in page are never reachable through it, and nobody can sign in with a password from outside: only a phone you paired can get in.

## Pair your phone

1. On **Pair Device**, select **Pair a phone** and give the phone a name, such as *Nick's iPhone*.
2. In the app, scan the QR code. If you're pairing the phone you're reading this on, copy the pairing code instead and paste it into the app.

The code works once and expires after five minutes. Your Apple Watch pairs through your iPhone, with nothing to scan.

**Paired devices** on the same page lists every phone, Watch and agent, when each was last seen, and how it reaches home. **Revoke** signs a lost phone out at once. A revoked phone can be brought back with **Re-pair**, which gives a fresh code with its name filled in.

## AI agents

**Connect an agent** on Pair Device gives you a prompt to paste into an AI coding agent such as Claude Code or Codex, so it can read the household and, if you allow it, make changes through FamilyFi's API. Agents connect on your home network only, and never get access to accounts, gateway settings or remote access.
