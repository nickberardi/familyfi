"use client";

import { SETTINGS_COPY as COPY } from "@/lib/settings-copy";

/** The web's add row field: Settings' full-size input, where Enter adds the member. */
export function AddMemberField({ value, onChange, onSubmit }: { value: string; onChange: (next: string) => void; onSubmit: () => void; disabled?: boolean }) {
  return (
    <input
      className="ff-input flex-1 font-normal"
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
