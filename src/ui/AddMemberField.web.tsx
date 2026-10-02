"use client";

import { SETTINGS_COPY as COPY } from "@/lib/settings-copy";

/** The web's add row field: Settings' full-size input, where Enter adds the member. */
export function AddMemberField({ value, onChange, onSubmit }: { value: string; onChange: (next: string) => void; onSubmit: () => void; disabled?: boolean }) {
  return (
    <input
      className="w-full flex-1 rounded-lg border border-[var(--ff-line)] px-3 py-2.5 text-[16px] font-normal text-[var(--ff-ink)]"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onSubmit();
        }
      }}
      placeholder={COPY.addMemberPlaceholder}
    />
  );
}
