import type { HouseholdStore } from "./household-store";
import { removeDeviceLocally } from "./household-state";
import type { Device } from "./types";

/**
 * The Devices list's writes, as every client sends them. Each resolves to the store's payload, or
 * undefined when the write failed (the store reports a failure). Assigning a device is
 * `assignDevice` in `group-writes.ts`.
 */

type Mutate = HouseholdStore["mutate"];

/** Forget a device; it leaves the list at once and comes back unassigned if it rejoins. */
export function deleteDevice(mutate: Mutate, device: Pick<Device, "mac">) {
  return mutate((send) => send(`/api/v1/devices/${encodeURIComponent(device.mac)}`, { method: "DELETE" }), {
    optimistic: (state) => removeDeviceLocally(state, device.mac),
  });
}

/** Turn quarantine of unassigned devices on or off. */
export function setQuarantineEnforced(mutate: Mutate, enforced: boolean) {
  return mutate((send) => send("/api/v1/settings/household", { method: "PUT", body: { quarantineEnforced: enforced } }));
}
