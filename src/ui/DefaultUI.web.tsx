import NextLink from "next/link";

import { TextField, TimeField, TogglePill } from "@/components/ui/Controls";
import { DayPicker } from "@/components/ui/DayPicker";
import { askConfirm } from "@/components/ui/ConfirmHost";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";

import type { UI } from "./UIContext";

/** The web's theme is its stylesheet: every colour is the page's own CSS variable. */
export const defaultUI: UI = {
  color: (token) => `var(--ff-${token})`,
  shadow: (name) => `var(--ff-${`shadow-${name}`})`,
  font: "var(--ff-font)",
  Icon,
  // The web's fields keep its own font, a URL's included.
  TextField: ({ label, value, onChange, placeholder, maxLength, onSubmit, disabled, mono, search }) =>
    search ? (
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="ff-input"
      />
    ) : (
      <TextField label={label} value={value} onChange={onChange} placeholder={placeholder} maxLength={maxLength} onSubmit={onSubmit} disabled={disabled} mono={mono} />
    ),
  // A disabled control disables each of its segments, as the web's segmented control draws it.
  Segmented: ({ name, value, segments, onChange, disabled, fit }) => (
    <Segmented name={name} grow={!fit} value={value} onChange={onChange} segments={disabled ? segments.map((segment) => ({ ...segment, disabled: true })) : segments} />
  ),
  Toggle: ({ label, on, onToggle, onLabel, offLabel, disabled, title }) => (
    <TogglePill label={label} on={on} onToggle={onToggle} onLabel={onLabel} offLabel={offLabel} disabled={disabled} title={title} />
  ),
  TimeField: ({ label, value, onChange, disabled }) => <TimeField label={label} value={value} onChange={onChange} disabled={disabled} />,
  DayPicker: ({ days, onToggle, disabled }) => <DayPicker days={days} onToggle={onToggle} disabled={disabled} />,
  Select: ({ label, value, options, onChange, placeholder, disabled, variant = "compact" }) => (
    <select
      className={
        variant === "field"
          ? "ff-input"
          : "ff-input max-w-full px-2 py-1.5 text-[14px] leading-5"
      }
      value={value}
      aria-label={label}
      disabled={disabled}
      aria-busy={disabled || undefined}
      onChange={(event) => onChange(event.target.value)}
    >
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  // A plain anchor around shared content, which sets its own layout and colours.
  Link: ({ href, children, label, current, grow, onNavigate }) => (
    <NextLink
      href={href}
      onClick={onNavigate}
      aria-label={label}
      aria-current={current ? "page" : undefined}
      style={{ display: "flex", flexDirection: "column", minWidth: 0, color: "inherit", textDecoration: "none", ...(grow ? { flex: 1 } : {}) }}
    >
      {children}
    </NextLink>
  ),
  // The web's own confirm dialog (`ConfirmHost`): nothing happens unless it is accepted.
  confirm: askConfirm,
  copyText: async (value) => {
    await navigator.clipboard?.writeText(value);
  },
};
