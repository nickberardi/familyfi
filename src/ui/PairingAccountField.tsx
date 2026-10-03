"use client";

import type { Account } from "@/lib/types";

import { FormField } from "./FormField";
import { useUI } from "./UIContext";

/** The administrator a new phone signs in as, as the platform's own menu. */
export function PairingAccountField({
  label,
  accounts,
  value,
  onChange,
}: {
  label: string;
  accounts: readonly Account[];
  value: string;
  onChange: (next: string) => void;
}) {
  const ui = useUI();
  return (
    <FormField label={label}>
      <ui.Select
        label={label}
        value={value}
        options={accounts.map((account) => ({ value: account.id, label: account.displayName }))}
        onChange={onChange}
        variant="field"
        testID="pairing-account"
      />
    </FormField>
  );
}
