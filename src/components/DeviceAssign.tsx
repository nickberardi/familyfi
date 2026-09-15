"use client";

import { api } from "@/lib/api";
import { assignDeviceLocally } from "@/lib/household-state";
import type { Device, Group } from "@/lib/types";
import { useAppData } from "./AppDataProvider";

export function assignPath(mac: string) {
  return `/api/v1/devices/${encodeURIComponent(mac)}/assignment`;
}

export function networkLabel(device: Device, networks: { id: string; name: string; vlanId: number }[]) {
  const match = networks.find((network) => network.id === device.networkId);
  if (match) return `${match.name} (VLAN ${match.vlanId})`;
  if (!device.inScope) return "Out of managed VLANs";
  return device.networkId ?? "Unknown network";
}

export function DeviceAssignSelect({
  device,
  groups,
}: {
  device: Device;
  groups: Group[];
}) {
  const { mutate, busy } = useAppData();
  return (
    <select
      className="w-full max-w-full rounded-[7px] border border-[rgba(60,60,67,.22)] bg-white px-2 py-1.5 text-[14px] disabled:opacity-50"
      value={device.groupId ?? ""}
      disabled={busy}
      aria-busy={busy || undefined}
      onChange={(event) => {
        const groupId = event.target.value || null;
        void mutate(
          () =>
            api<{ device: Device; change: { changeId: string } }>(assignPath(device.mac), {
              method: "PUT",
              body: JSON.stringify({ groupId }),
            }),
          (state) => assignDeviceLocally(state, device.mac, groupId),
        );
      }}
    >
      <option value="">Unassigned</option>
      {groups
        .filter((group) => group.kind === "family")
        .map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
      {groups
        .filter((group) => group.kind === "things")
        .map((group) => (
          <option key={group.id} value={group.id}>
            {group.name} (group)
          </option>
        ))}
    </select>
  );
}
