"use client";

import { SETTINGS_COPY as COPY, TIMEZONES } from "@/lib/settings-copy";

import { useUI } from "./UIContext";

/** The household's time zone, from the platform's menu; a zone set elsewhere stays on offer. */
export function TimezoneField({ value, onChange, disabled }: { value: string; onChange: (next: string) => void; disabled?: boolean }) {
  const ui = useUI();
  const zones: readonly string[] = TIMEZONES.includes(value as (typeof TIMEZONES)[number]) || !value ? TIMEZONES : [value, ...TIMEZONES];
  return (
    <ui.Select label={COPY.timezone} value={value} options={zones.map((zone) => ({ value: zone, label: zone }))} onChange={onChange} disabled={disabled} variant="field" testID="settings-timezone" />
  );
}
