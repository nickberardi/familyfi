"use client";

import type { Account } from "@/lib/types";

/** The web's pairing sheet field: a label around a full-width select of the administrators. */
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
  return (
    <label className="text-[14px] font-semibold text-[var(--ff-muted)]">
      {label}
      <select
        data-testid="pairing-account"
        className="ff-input mt-1 font-normal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.displayName}
          </option>
        ))}
      </select>
    </label>
  );
}
