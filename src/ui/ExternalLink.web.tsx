"use client";

import type { CSSProperties } from "react";
import { StyleSheet, type StyleProp, type TextStyle } from "react-native";

import { useUI } from "./UIContext";

/** The web's external link: its words and an out-arrow in one anchor, opening a new tab with no referrer. */
export function ExternalLink({ href, children, style, color, testID }: { href: string; children: string; style?: StyleProp<TextStyle>; color: string; testID?: string }) {
  const ui = useUI();
  const flat = StyleSheet.flatten(style) ?? {};
  // A DOM style reads a bare line height as a multiple of the font size; react-native-web's are pixels.
  const css = { ...flat, lineHeight: typeof flat.lineHeight === "number" ? `${flat.lineHeight}px` : flat.lineHeight } as CSSProperties;
  return (
    <a href={href} target="_blank" rel="noreferrer" data-testid={testID} className="inline-flex items-center gap-1" style={css}>
      {children}
      <ui.Icon name="arrow-square-out" size={14} color={color} />
    </a>
  );
}
