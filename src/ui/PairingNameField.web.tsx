"use client";

/** The web's pairing sheet field: a label around a full-width input. */
export function PairingNameField({ label, value, onChange }: { label: string; value: string; onChange: (next: string) => void }) {
  return (
    <label className="text-[14px] font-semibold text-[var(--ff-muted)]">
      {label}
      <input
        className="mt-1 w-full rounded-lg border border-[var(--ff-line)] px-3 py-2.5 text-[16px] font-normal text-[var(--ff-ink)]"
        value={value}
        maxLength={80}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
