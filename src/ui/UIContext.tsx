"use client";

import { createContext, useContext, type ComponentType, type ReactNode } from "react";

import type { IconName } from "@/lib/icons";

import type { ShadowName } from "./palette";

import { defaultUI } from "./DefaultUI";

/**
 * What a shared component needs from the platform it renders on. The web renders shared
 * components through react-native-web with CSS variables and Phosphor glyphs (`DefaultUI.web.tsx`);
 * the native app provides its palette for the current appearance and its own icons.
 */
export type UI = {
  /** A colour by its `--ff-*` token name, without the prefix: `color("accent")`. */
  color: (token: string) => string;
  /** A shadow by its `--ff-shadow-*` name, without the prefix: `shadow("toast")`, as a CSS box-shadow. */
  shadow: (name: ShadowName) => string;
  /** The text font, or undefined for the platform's system font. */
  font?: string;
  /** A decorative glyph; the label beside it carries the meaning. */
  Icon: ComponentType<{ name: IconName; size: number; color: string }>;
  /** A single-line text field: the web's input, or the platform's own. */
  TextField: ComponentType<UITextFieldProps>;
  /** A choice of a few options side by side: the web's segmented control, or the platform's own. */
  Segmented: ComponentType<UISegmentedProps<string>>;
  /** A setting that is on or off: the web's pill, which names its state, or the platform's switch. */
  Toggle: ComponentType<UIToggleProps>;
  /** A time of day, "HH:MM": the web's time input, or the platform's time picker. */
  TimeField: ComponentType<UITimeFieldProps>;
  /** The days of the week, each on or off, 0 (Sunday) through 6. */
  DayPicker: ComponentType<UIDayPickerProps>;
  /** One choice from a list: the web's select, or the platform's menu. */
  Select: ComponentType<UISelectProps>;
  /** Goes to a page by the web's path; the app maps the path to its own route. */
  Link: ComponentType<UILinkProps>;
  /** Asks before something that can't be undone; resolves true to go ahead. The web goes ahead without asking. */
  confirm: (request: UIConfirmRequest) => Promise<boolean>;
  /** Puts text on the clipboard: a pairing code to paste on another phone. */
  copyText: (value: string) => Promise<void>;
};

export type UIToggleProps = {
  /** Its accessible name; the state comes from the control. */
  label: string;
  on: boolean;
  onToggle: () => void;
  /** The words for each state where the platform shows them: "On" and "Off" unless given. */
  onLabel?: string;
  offLabel?: string;
  disabled?: boolean;
  /** A hint on what the control does, where the platform shows one. */
  title?: string;
  testID?: string;
};

export type UITimeFieldProps = {
  label: string;
  /** "HH:MM", 24-hour. */
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  testID?: string;
};

export type UIDayPickerProps = {
  days: number[];
  onToggle: (day: number) => void;
  disabled?: boolean;
  /** Each day's control is `${testID}-${day}`. */
  testID?: string;
};

export type UISelectProps = {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (next: string) => void;
  /** Shown while nothing is chosen. */
  placeholder?: string;
  disabled?: boolean;
  /** `compact` sits in a row, as a device's group does; `field` fills a form, as a sheet's picker does. */
  variant?: "compact" | "field";
  testID?: string;
};

export type UILinkProps = {
  /** The web's path, e.g. `/rules/r1` or `/devices/<mac>?from=<group>`. */
  href: string;
  children: ReactNode;
  /** Its accessible name, when its content does not say where it goes. */
  label?: string;
  /** This link is the page being shown. */
  current?: boolean;
  /** Takes the room left in its row. */
  grow?: boolean;
  /** Runs as the link is followed, before the new page shows: a sheet closes itself. */
  onNavigate?: () => void;
  testID?: string;
};

export type UIConfirmRequest = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** The action removes something. */
  destructive?: boolean;
};

export type UITextFieldProps = {
  /** Its accessible name; a visible label sits above it, outside the field. */
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  maxLength?: number;
  /** Return (Enter) submits, so a form works without a submit button of its own. */
  onSubmit?: () => void;
  disabled?: boolean;
  /** For a URL: no capitals or corrections, and the URL keyboard where there is one. */
  url?: boolean;
  /** Capitals as typed, for a monogram. */
  capitals?: boolean;
  /** A domain or address, set in the monospaced face with no capitals or corrections. */
  mono?: boolean;
  /** A search box, which the platform may draw as its own search field. */
  search?: boolean;
  autoFocus?: boolean;
  testID?: string;
};

export type UISegmentedProps<T extends string> = {
  /** Its accessible name. */
  name: string;
  value: T;
  segments: readonly { value: T; label: string; disabled?: boolean }[];
  onChange: (next: T) => void;
  disabled?: boolean;
  /** Only as wide as its segments, where the platform would otherwise stretch it across the row. */
  fit?: boolean;
  testID?: string;
};

/** A pressed control's opacity: the web's `--ff-press-opacity`. */
export const PRESS_OPACITY = 0.72;

const UIContext = createContext<UI>(defaultUI);

export const UIProvider = UIContext.Provider;

export function useUI(): UI {
  return useContext(UIContext);
}

/** A `--ff-*` CSS variable from the shared display logic, as its token name: `var(--ff-on)` is "on". */
export function tokenOf(css: string): string {
  return /^var\(--ff-([a-z0-9-]+)\)$/.exec(css)?.[1] ?? "ink";
}
