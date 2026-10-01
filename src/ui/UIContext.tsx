"use client";

import { createContext, useContext, type ComponentType } from "react";

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
  /** For a URL: monospaced, no capitals or corrections. */
  url?: boolean;
  /** Capitals as typed, for a monogram. */
  capitals?: boolean;
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
