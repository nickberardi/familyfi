# Phase 4 live enforcement checklist

Use a disposable test client. Do not click live UniFi writes from an agent session unless the operator asked.

This is the **application** path (Settings key + Reconcile), not the spike CLI. Spike MAC block/restore already passed: [RESULTS.md](../spike/RESULTS.md).

## Before

1. Snapshot administrator firewall policies and relative order for the test source zone.
2. Note IPv4 and, if the client has it, IPv6 connectivity plus LAN access (printer or another LAN host).
3. Confirm FamilyFi Settings shows the expected site and managed VLANs only.

## Steps

1. Assign only the test MAC to a non-protected Family group with an enabled bedtime.
2. Reconcile. Confirm a `FamilyFi …` policy exists for that group and the admin rules are unchanged.
3. During bedtime: test client loses **internet**; LAN still works; unrelated clients stay up. New TCP and an already-open stream both fail or stall.
4. Pause: internet returns (subject to admin rules). UniFi policy `enabled` is false; `schedule` remains.
5. Resume during bedtime: internet blocked again.
6. Unassign the device (quarantine): blocked independently of bedtime.
7. Cleanup: reassign or delete the test group as you prefer; confirm administrator policy JSON and relative order match the snapshot.

## Record here after a pass

| Item | Result |
| --- | --- |
| Console / Network version | (fill) |
| IPv4 internet loss / restore | (fill) |
| IPv6 | not claimed unless tested |
| LAN preserved | (fill) |
| Unrelated clients | (fill) |
| Admin order unchanged | (fill) |
| Cleanup | (fill) |

Household Phase 3 use already proved IPv4 MAC block/restore on Network 10.6.106 (local integration). IPv6 is still not recorded.
