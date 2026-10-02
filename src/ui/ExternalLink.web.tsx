"use client";

import type { CSSProperties } from "react";
import { StyleSheet, type StyleProp, type TextStyle } from "react-native";

/** The web's external link: a new tab, with no referrer, as every link off FamilyFi opens. */
export function ExternalLink({ href, children, style, testID }: { href: string; children: string; style?: StyleProp<TextStyle>; testID?: string }) {
  const flat = StyleSheet.flatten(style) ?? {};
  // A DOM style reads a bare line height as a multiple of the font size; react-native-web's are pixels.
  const css = { ...flat, lineHeight: typeof flat.lineHeight === "number" ? `${flat.lineHeight}px` : flat.lineHeight } as CSSProperties;
  return (
    <a href={href} target="_blank" rel="noreferrer" data-testid={testID} style={css}>
      {children}
    </a>
  );
}
