"use client";

import { assignDevicesCopy } from "@/lib/device-assign";
import type { Group } from "@/lib/types";

import { Alert } from "./Alert";

/** A group with no devices, sent to the Devices list to get one: why it needs one. */
export function AssignNeededBanner({ group }: { group: Pick<Group, "name"> }) {
  const copy = assignDevicesCopy(group);
  return (
    <Alert tone="warning" title={copy.needsTitle} role="status" testID="assign-needed">
      {copy.needsBody}
    </Alert>
  );
}
