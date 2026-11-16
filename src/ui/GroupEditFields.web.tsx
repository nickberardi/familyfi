"use client";

import type { ReactNode } from "react";

const LABEL = "flex flex-col gap-1 text-[14px] font-semibold text-[var(--ff-muted)]";

/**
 * The web's Edit sheet field: a `<label>` around the label and its field, so clicking the label
 * focuses it, or a plain group around a set of choices, which a label would press instead.
 */
export function EditField({ label, group, note, children }: { label: string; group?: boolean; note?: string; children: ReactNode }) {
  if (!group) {
    return (
      <label className={LABEL}>
        {label}
        <span className="mt-1 flex flex-col">{children}</span>
        {note ? <span className="font-normal">{note}</span> : null}
      </label>
    );
  }
  return (
    <div className={LABEL}>
      <span>{label}</span>
      {children}
      {note ? <span className="font-normal">{note}</span> : null}
    </div>
  );
}

/** What a group's Block button stands for, as the web's select with its help under it. */
export function BlockButtonField({
  label,
  help,
  choices,
  value,
  onChange,
  disabled,
}: {
  label: string;
  help: string;
  choices: readonly { value: string; label: string }[];
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className={LABEL}>
        {label}
        <select className="ff-input mt-1" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} aria-describedby="group-block-button-help" data-testid="group-block-button">
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      <p id="group-block-button-help" className="text-[14px] leading-5 text-[var(--ff-ink-2)]">
        {help}
      </p>
    </div>
  );
}
