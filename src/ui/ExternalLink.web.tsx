"use client";

import type { CSSProperties } from "react";
import { StyleSheet, type StyleProp, type TextStyle } from "react-native";

/** The web's external link: a new tab, with no referrer, as every link off FamilyFi opens. */
export function ExternalLink({ href, children, style, testID }: { href: string; children: string; style?: StyleProp<TextStyle>; testID?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" data-testid={testID} style={StyleSheet.flatten(style) as CSSProperties}>
      {children}
    </a>
  );
}
