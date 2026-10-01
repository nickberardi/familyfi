"use client";

import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { useUI } from "./UIContext";

/** One window's controls, outlined and named for screen readers. */
export function RuleWindowFrame({ legend, children, testID }: { legend: string; children: ReactNode; testID?: string }) {
  const ui = useUI();
  return (
    <View role="group" aria-label={legend} testID={testID} style={[styles.frame, { borderColor: ui.color("hairline-card") }]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { gap: 10, borderRadius: 9, borderWidth: 1, padding: 12 },
});
