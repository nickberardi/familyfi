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

/**
 * A toggle: one control, two states, and it always names the state it is *in*.
 *
 * On/Off is the default pairing and the one the rule rows use, but any two-state pair
 * works — Enforced/Off for quarantine, Checking/Paused for a category — so pass
 * `onLabel` and `offLabel` rather than hand-rolling another button. The leading dot
 * fills when on, which is what stops a lone pill reading as one of a pair of buttons:
 * before it, a quarantine control that said "Off" while quarantine was *enforced* was
 * the only way to say "turn it off".
 *
 * `role="switch"` with `aria-checked`, not `aria-pressed`: this is a setting that is
 * on or off, not a button that stays depressed, and a screen reader announces the two
 * differently. Pinned to 33px, the height `TimeField` and the segmented control share,
 * so a mixed row of them sits on one baseline.
 */
export function TogglePill({
  on,
  onToggle,
  label,
  onLabel = "On",
  offLabel = "Off",
  disabled = false,
  title,
}: {
  on: boolean;
  onToggle: () => void;
  /** Accessible name, e.g. "Betsy Internet". The state comes from `aria-checked`. */
  label: string;
  onLabel?: string;
  offLabel?: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={onToggle}
      className="inline-flex h-[33px] flex-none items-center gap-1.5 rounded-[7px] border pr-[11px] pl-2 text-[13px] font-semibold disabled:opacity-40"
      style={{
        background: on ? "var(--ff-accent-fill)" : "var(--ff-card)",
        borderColor: on ? "var(--ff-accent-line)" : "var(--ff-input-line)",
        color: on ? "var(--ff-accent-hover)" : "var(--ff-ink-2)",
      }}
    >
      <span
        aria-hidden="true"
        className="block h-[9px] w-[9px] flex-none rounded-full"
        style={{
          background: on ? "var(--ff-accent)" : "transparent",
          boxShadow: on ? "none" : "inset 0 0 0 1.5px var(--ff-ink-3)",
        }}
      />
      {on ? onLabel : offLabel}
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
