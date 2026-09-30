import { createContext, useContext, type ComponentType } from "react";

import type { IconName } from "@/lib/icons";

import { defaultUI } from "./DefaultUI";

/**
 * What a shared component needs from the platform it renders on. The web renders shared
 * components through react-native-web with CSS variables and Phosphor glyphs (`DefaultUI.web.tsx`);
 * the native app provides its palette for the current appearance and its own icons.
 */
export type UI = {
  /** A colour by its `--ff-*` token name, without the prefix: `color("accent")`. */
  color: (token: string) => string;
  /** The text font, or undefined for the platform's system font. */
  font?: string;
  /** A decorative glyph; the label beside it carries the meaning. */
  Icon: ComponentType<{ name: IconName; size: number; color: string }>;
};

const UIContext = createContext<UI>(defaultUI);

export const UIProvider = UIContext.Provider;

export function useUI(): UI {
  return useContext(UIContext);
}

/** A `--ff-*` CSS variable from the shared display logic, as its token name: `var(--ff-on)` is "on". */
export function tokenOf(css: string): string {
  return /^var\(--ff-([a-z0-9-]+)\)$/.exec(css)?.[1] ?? "ink";
}
