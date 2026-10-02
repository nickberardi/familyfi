"use client";

import { FormField } from "./FormField";
import { useUI } from "./UIContext";

/** The name a new phone pairs under, as the platform's own text field. */
export function PairingNameField({ label, value, onChange }: { label: string; value: string; onChange: (next: string) => void }) {
  const ui = useUI();
  return (
    <FormField label={label}>
      <ui.TextField label={label} value={value} onChange={onChange} maxLength={80} testID="pairing-name" />
    </FormField>
  );
}
