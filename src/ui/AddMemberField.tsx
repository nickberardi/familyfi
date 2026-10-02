"use client";

import { SETTINGS_COPY as COPY } from "@/lib/settings-copy";

import { useUI } from "./UIContext";

/** Household's add row field, as the platform's own text field; Return adds the member. */
export function AddMemberField({ value, onChange, onSubmit, disabled }: { value: string; onChange: (next: string) => void; onSubmit: () => void; disabled?: boolean }) {
  const ui = useUI();
  return <ui.TextField label={COPY.addMemberPlaceholder} value={value} onChange={onChange} placeholder={COPY.addMemberPlaceholder} onSubmit={onSubmit} disabled={disabled} testID="settings-add-member" />;
}
