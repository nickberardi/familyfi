"use client";

import type { Device, Group } from "@/lib/types";
import { DeviceAssignControl } from "@/ui/DeviceAssignControl";
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
  return <DeviceAssignControl device={device} groups={groups} mutate={store.mutate} disabled={busy} />;
}
