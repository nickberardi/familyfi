"use client";

import { SETTINGS_COPY as COPY } from "@/lib/settings-copy";

/** The web's Admin chip: a checkbox and its word, accented while on. */
export function AdminControl({ on, onPress }: { name: string; on: boolean; onPress: () => void; disabled?: boolean; testID?: string }) {
  return (
    <button
      type="button"
      className="flex flex-none items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[14px] font-semibold"
      style={{
        borderColor: on ? "var(--ff-accent-line)" : "var(--ff-control-line)",
        background: on ? "var(--ff-accent-wash)" : "var(--ff-ink-on-fill)",
        color: on ? "var(--ff-accent)" : "var(--ff-muted)",
      }}
      onClick={onPress}
    >
      <span
        className="inline-flex h-[15px] w-[15px] items-center justify-center rounded-[4px] border text-[10px] leading-none text-[var(--ff-ink-on-fill)]"
        style={{
          borderColor: on ? "var(--ff-accent)" : "var(--ff-disabled)",
          background: on ? "var(--ff-accent)" : "var(--ff-ink-on-fill)",
        }}
      >
        {on ? "✓" : ""}
      </span>
      {COPY.admin}
    </button>
  );
}
