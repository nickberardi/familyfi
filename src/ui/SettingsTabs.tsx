import { SETTINGS_COPY as COPY, SETTINGS_TABS, settingsTab, type SettingsTab } from "@/lib/settings-copy";

import { useUI } from "./UIContext";

/** Settings' Household, Gateway and Maintenance tabs, the same on the web and in the app. */
export function SettingsTabs({ value, onChange }: { value: SettingsTab; onChange: (next: SettingsTab) => void }) {
  const ui = useUI();
  return <ui.Segmented name={COPY.tabs} value={value} segments={SETTINGS_TABS} onChange={(next) => onChange(settingsTab(next))} testID="settings-tabs" />;
}
