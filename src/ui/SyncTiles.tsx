"use client";

import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

/** Sync's four tiles, wrapping as the screen narrows. */
export function SyncTiles({ children }: { children: ReactNode }) {
  return <View style={styles.tiles}>{children}</View>;
}

const styles = StyleSheet.create({ tiles: { flexDirection: "row", flexWrap: "wrap", gap: 14 } });
