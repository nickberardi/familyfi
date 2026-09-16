/**
 * Small shared controls for the Rules surface: the labelled time field, the
 * On/Off state pill, and the card container.
 */

import type { ReactNode } from "react";

/** "Offline" / "Back on" time input, label inline as in the design. */
export function TimeField({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-none items-center gap-1.5">
      <span className="text-[11px]" style={{ color: "var(--ff-ink-4)" }}>
        {label}
      </span>
      <input
        type="time"
        aria-label={label}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-[7px] border px-[7px] py-[5px] text-[12.5px] outline-none disabled:cursor-not-allowed disabled:opacity-40"
        style={{ borderColor: "var(--ff-input-line)", background: "var(--ff-card)" }}
      />
    </label>
  );
}

/** The On/Off pill that ends each rule row. */
export function TogglePill({
  on,
  onToggle,
  label,
}: {
  on: boolean;
  onToggle: () => void;
  /** Accessible name, e.g. "Betsy Internet". */
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={`${label} ${on ? "On" : "Off"}`}
      onClick={onToggle}
      className="flex-none rounded-[7px] border px-3 py-1.5 text-[11.5px] font-semibold"
      style={{
        background: on ? "var(--ff-accent-fill)" : "var(--ff-card)",
        borderColor: on ? "var(--ff-accent-line)" : "var(--ff-control-line)",
        color: on ? "var(--ff-accent-hover)" : "var(--ff-ink-2)",
      }}
    >
      {on ? "On" : "Off"}
    </button>
  );
}

/**
 * White card with the hairline border. Per the Card System the border is the
 * ground's business — this app's pages are a light field, so the border is on.
 */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`overflow-hidden rounded-xl ${className}`}
      style={{
        background: "var(--ff-card)",
        border: "1px solid var(--ff-hairline-card)",
      }}
    >
      {children}
    </div>
  );
}
