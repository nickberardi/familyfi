"use client";

import type { ReactNode } from "react";

/**
 * The web's form field (`Field` in `src/components/ui/Controls.tsx`): a `<label>` around the label
 * and its control, so clicking the label focuses the field. React Native has no label element.
 */
export function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-semibold" style={{ color: "var(--ff-ink-3)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}
