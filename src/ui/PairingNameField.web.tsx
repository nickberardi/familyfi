"use client";

/** The web's pairing sheet field: a label around a full-width input. */
export function PairingNameField({ label, value, onChange }: { label: string; value: string; onChange: (next: string) => void }) {
  return (
    <label className="text-[14px] font-semibold text-[var(--ff-muted)]">
      {label}
      <input
        className="ff-input mt-1 font-normal"
        value={value}
        maxLength={80}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
