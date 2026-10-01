"use client";

import { deviceGroupLabel, deviceGroupOptions } from "@/lib/device-list";
import { assignDevice } from "@/lib/group-writes";
import type { HouseholdStore } from "@/lib/household-store";
import type { Device, Group } from "@/lib/types";

import { useUI } from "./UIContext";

/** The group a device belongs to, changed in place: Unassigned, a family group, or a things group. */
export function DeviceAssignControl({
  device,
  groups,
  mutate,
  disabled,
}: {
  device: Device;
  groups: Pick<Group, "id" | "name" | "kind">[];
  mutate: HouseholdStore["mutate"];
  disabled?: boolean;
}) {
  const ui = useUI();
  return (
    <ui.Select
      label={deviceGroupLabel(device)}
      value={device.groupId ?? ""}
      options={deviceGroupOptions(groups)}
      onChange={(next) => void assignDevice(mutate, device, next || null)}
      disabled={disabled}
      testID={`device-group-${device.mac}`}
    />
  );
}
