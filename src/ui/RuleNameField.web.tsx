"use client";

import type { ReactNode } from "react";

/** The web's rule-name label: a `<label>` around the label and its field, so clicking the label focuses the field. */
export function RuleNameField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-[var(--ff-ink-3)]">
      {label}
      {children}
    </label>
  );
}
