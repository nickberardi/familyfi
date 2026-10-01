"use client";

import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useUI } from "./UIContext";

/** A titled box that opens to show more. */
export function Disclosure({ title, children, testID }: { title: string; children: ReactNode; testID?: string }) {
  const ui = useUI();
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.box, { borderColor: ui.color("hairline-card") }]} testID={testID}>
      <Pressable role="button" aria-expanded={open} onPress={() => setOpen(!open)} testID={testID ? `${testID}-toggle` : undefined}>
        <Text style={{ fontFamily: ui.font, fontSize: 12.5, lineHeight: 18, fontWeight: "600", color: ui.color("ink") }}>
          {open ? "▾" : "▸"} {title}
        </Text>
      </Pressable>
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: 12, borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  body: { marginTop: 8 },
});
