"use client";

import { SETTINGS_COPY as COPY } from "@/lib/settings-copy";

import { useUI } from "./UIContext";

/** Whether an adult is an admin, as the platform's switch. Turning it on for an adult with no login starts one. */
export function AdminControl({ name, on, onPress, disabled, testID }: { name: string; on: boolean; onPress: () => void; disabled?: boolean; testID?: string }) {
  const ui = useUI();
  return <ui.Toggle label={`${name} ${COPY.admin.toLowerCase()}`} on={on} onToggle={onPress} onLabel={COPY.admin} offLabel={COPY.admin} disabled={disabled} testID={testID} />;
}
