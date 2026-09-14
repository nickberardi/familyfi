# UniFi spike operator checklist

Use a test phone or laptop you can inconvenience. Do not pick a household production router, NAS, or the machine running FamilyFi unless you accept losing internet on it.

## Prerequisites

1. UniFi Network 10.4.x-compatible console with an integration API key.
2. Local base `https://<console-ip>/proxy/network/integration` **or** cloud `UNIFI_CONSOLE_ID`.
3. One or two test MACs that currently have internet and LAN access.
4. A way to observe the **client** (browser, ping, existing video stream), not only the API.

## Commands

Put CLI-only variables in `.env` or the environment. They are not the application credential store.

```bash
# Read-only inventory (do not commit the output)
make spike SPIKE_ARGS=discover

# Mutating steps require confirmation
UNIFI_SPIKE_CONFIRM=1 UNIFI_SPIKE_MACS=aa:bb:cc:dd:ee:ff make spike SPIKE_ARGS=apply
# On the test device: internet should fail; LAN (printer, other LAN host) should still work.
# Already-open streams should drop or stall. Unrelated devices should stay online.

UNIFI_SPIKE_CONFIRM=1 make spike SPIKE_ARGS=disable
# On the test device: internet should return (subject to existing admin rules).

UNIFI_SPIKE_CONFIRM=1 make spike SPIKE_ARGS=cleanup
```

Local consoles with a private certificate: `UNIFI_TLS_INSECURE=1`. Multiple sites: `UNIFI_SITE_ID`.

## What counts as pass

- Official `BLOCK` policy with `MAC_ADDRESS` source filter toward External. Live check found BLOCK more effective than REJECT.
- Test client loses internet; LAN remains; others unaffected.
- `enabled: false` restores internet.
- Administrator policies' configuration and relative order unchanged.
- Spike policies deleted (or ids preserved if cleanup fails).

If official MAC enforcement or coexistence fails, stop. Do not switch to client BLOCK, undocumented v2, or LAN ACL.
