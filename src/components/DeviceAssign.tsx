"use client";

import { deviceGroupLabel, deviceGroupOptions } from "@/lib/device-list";
import { assignDevice } from "@/lib/group-writes";
import type { Device, Group } from "@/lib/types";
export { networkLabel } from "@/lib/device-assign";
import { useAppData } from "./AppDataProvider";

export function DeviceAssignSelect({
  device,
  groups,
}: {
  device: Device;
  groups: Group[];
}) {
  const { store, busy } = useAppData();
  return (
    <select
      className="w-full max-w-full rounded-[7px] border border-[var(--ff-input-line)] bg-[var(--ff-card)] px-2 py-1.5 text-[14px] disabled:opacity-50"
      value={device.groupId ?? ""}
      aria-label={deviceGroupLabel(device)}
      disabled={busy}
      aria-busy={busy || undefined}
      onChange={(event) => {
        void assignDevice(store.mutate, device, event.target.value || null);
      }}
    >
      {deviceGroupOptions(groups).map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
