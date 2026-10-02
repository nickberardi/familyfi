"use client";

import { SETTINGS_COPY as COPY, TIMEZONES } from "@/lib/settings-copy";

/** The web's timezone field: type any zone, with the common ones suggested. */
export function TimezoneField({ value, onChange }: { value: string; onChange: (next: string) => void; disabled?: boolean }) {
  return (
    <label className="min-w-[220px] flex-1 text-[14px] font-semibold text-[var(--ff-muted)]">
      {COPY.timezone}
      <input
        list="ff-tz"
        className="mt-1 w-full rounded-lg border border-[var(--ff-line)] px-3 py-2.5 text-[16px] font-normal text-[var(--ff-ink)]"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id="ff-tz">
        {TIMEZONES.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
    </label>
  );
}
