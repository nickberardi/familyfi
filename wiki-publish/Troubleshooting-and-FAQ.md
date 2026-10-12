# Troubleshooting and FAQ

## Troubleshooting

### "Sync needs attention"

FamilyFi couldn't finish applying your rules to the gateway. Open **Sync** to see what failed. The usual causes:

- **The gateway can't be reached.** Check the FamilyFi computer can reach the console's address, and that the console is up.
- **The API key stopped working**, for example it was deleted in UniFi. Create a new one and paste it in **Settings**.

FamilyFi tries again on its own. Your gateway keeps the last rules it was given in the meantime.

### A schedule starts at the wrong time

Make sure the household time zone in **Settings** matches your UniFi console's time zone. The gateway runs the schedules on its own clock.

### A website rule doesn't block a site

Website rules work by watching DNS lookups, so a device using encrypted DNS gets around them: iCloud Private Relay, a browser's "secure DNS" setting, or a VPN app. Turn those off on the device, or use a category or app rule instead.

### A new device had internet before it was quarantined

FamilyFi checks for new devices every few minutes, so a brand-new device can be online briefly before it's blocked. Once it's found, it stays blocked until you assign it.

### A device keeps showing up as new

It's probably using a *rotating* private Wi-Fi address. On the device, set the private address for your home network to **Fixed** (iPhone and iPad) or the equivalent, then assign it once more.

### I forgot the admin password

It's printed in the log every time FamilyFi starts. In the FamilyFi folder, run:

```bash
docker compose logs app | grep -A1 "username: admin"
```

### "Pair a phone" is greyed out

Remote access is **Off**. Choose one of the options under **Pair Device → Remote access** first; see [Phone and Watch app](Phone-and-Watch-app).

### The app can't reach home

Check that **Pair Device → Remote access** shows the address you expect and says **On**. Each option's page has its own troubleshooting section.

If you use a **Quick tunnel**, its address changes whenever FamilyFi restarts or updates, and a phone that only knew the old address can't find the new one. **Revoke** the phone under **Paired devices**, then **Re-pair** it with a new code. For an address that doesn't change, use Cloudflare, Tailscale or My domain. See [Quick tunnel](Remote-access-Quick-tunnel).

## FAQ

### Will FamilyFi change my own firewall rules?

No. FamilyFi only adds, changes and removes the policies it created itself, and it tracks them by ID, never by name. Your own policies are never modified, disabled, deleted or reordered.

### What happens if FamilyFi is off?

Your gateway keeps enforcing the last rules it was given, and schedules keep starting and ending on time because they're stored on the gateway. What waits for FamilyFi to come back: a timed pause ending, an allowance ending, and quarantining newly arrived devices.

### Does my data leave the house?

No. FamilyFi talks to your UniFi console on your network, and checks GitHub for new versions. Nothing about your household is sent anywhere else. If you turn on remote access, your phone connects to your own FamilyFi through the route you chose.

### Can I manage more than one household or site?

Each FamilyFi install serves one household and one UniFi site. For another household, run another install.

### Can my kids sign in?

No. Only administrators use FamilyFi. Teens and children, and adults without administrator access, have no sign-in.

### Is it open source?

FamilyFi is **source-available** under the Business Source License 1.1. You can read and change the code and run it for your own household for free. Offering it to other households, hosting it, or selling it needs a commercial license. Each version becomes GPL v3 four years after it's released. See [licensing](https://github.com/nickberardi/familyfi/blob/main/docs/licensing.md).

### Something else?

Open a [GitHub issue](https://github.com/nickberardi/familyfi/issues). Please remove passwords, API keys and IP addresses from anything you paste.
