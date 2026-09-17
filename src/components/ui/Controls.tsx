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

/**
 * A single-line text input. Replaces the three hand-rolled input styles that had
 * grown up separately in the settings page, the new-rule sheet and the group form.
 */
export function TextField({
  label,
  value,
  onChange,
  placeholder,
  disabled = false,
  maxLength,
  onSubmit,
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  /** Fires on Enter, so an add-row works without a surrounding form. */
  onSubmit?: () => void;
  mono?: boolean;
}) {
  return (
    <input
      type="text"
      aria-label={label}
      disabled={disabled}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && onSubmit) {
          event.preventDefault();
          onSubmit();
        }
      }}
      className={`w-full min-w-0 rounded-[7px] border px-[10px] py-[7px] text-[13.5px] outline-none disabled:cursor-not-allowed disabled:opacity-40 ${
        mono ? "font-mono" : ""
      }`}
      style={{ borderColor: "var(--ff-input-line)", background: "var(--ff-card)" }}
    />
  );
}

/** Label over a control, the shape the sheets had been repeating inline. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span
        className="mb-1.5 block text-[12px] font-semibold"
        style={{ color: "var(--ff-ink-3)" }}
      >
        {label}
      </span>
      {children}
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
