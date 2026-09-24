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

## Verification run

`pnpm spike verify` runs a fixed list of scenarios and writes a dated record to `docs/verification/`, so proof on hardware is something a release can cite. Use the same test devices as above: they lose internet during the run.

| Scenario | What it does | What you watch on the test device |
| --- | --- | --- |
| `client-contract` | The API cases CI runs against the mock (`src/server/unifi/contract-cases.ts`), on disabled scratch policies for a MAC no device has | Nothing |
| `ipv4-block-restore` | BLOCK policy for the first MAC, then `enabled: false`, then delete | `curl -4` fails and LAN works; then `curl -4` works |
| `ipv6-block-restore` | The same, checking the policy covers IPv4 and IPv6 | `curl -6` fails; then works. Needs global IPv6 on the device |
| `bedtime-midnight` | A bedtime that crosses midnight and holds now, then one that crosses midnight and excludes now | Blocked, then open. Run between 23:00 and 00:00 console time to also watch it stay blocked past midnight |
| `concurrent-macs` | Blocks two MACs at once, releases the second, then disables the first | Both blocked; second back; first back. Needs two MACs |
| `pause-resume-schedule` | Bedtime on, pause (`enabled: false`), resume, checking the schedule reads back unchanged each time | Blocked; open while paused; blocked again |
| `ownership-refusal` | Tries to update and delete an administrator-created policy through the ownership guard | Nothing. It must refuse before sending anything |

```bash
UNIFI_SPIKE_MACS=aa:bb:cc:dd:ee:ff,aa:bb:cc:dd:ee:00 pnpm spike verify --confirm \
  --console-model "UCG Max" --console-firmware 4.3.6 --timezone America/New_York
```

- `--confirm` is required every time; `UNIFI_SPIKE_CONFIRM` does not count.
- `--console-firmware` is the UniFi OS version from the console's settings. The UniFi Network version is read from the console.
- `--timezone` is the console's clock, which the bedtime windows are built on.
- At each device check the CLI asks what you see: `y`, `n`, or `s` to skip. A `n` fails the scenario and moves on. A skipped check, or `--no-device-checks`, records the scenario as "API only".
- `--only bedtime-midnight` runs one scenario, for example again just before midnight.

Every write goes through the app's ownership guard with this run's own creations as the record, so the run cannot change a policy it did not create. Each scenario deletes its policies when it ends, pass or fail. If a delete fails, the ids go to the spike state file: run `UNIFI_SPIKE_CONFIRM=1 pnpm spike cleanup`. The run ends by checking every other policy and their order are as it found them.

Commit the record's `.json` and `.md` with the rewritten table in `docs/testing.md`. Read the `.md` first: it should say nothing about your household beyond the console model.

`UNIFI_MOCK=1 pnpm spike verify --confirm` runs the same scenarios against the local mock, for trying the tool. Its record goes to `scripts/spike/.live-verify/`, which git ignores; it is not a verification record.
