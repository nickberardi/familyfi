"use client";

import { Linking, Pressable, StyleSheet, Text, type Insets, type StyleProp, type TextStyle } from "react-native";

import { PRESS_OPACITY, useUI } from "./UIContext";

/** A link that leaves FamilyFi, its words and an out-arrow: the phone hands it to the system browser. */
export function ExternalLink({
  href,
  children,
  style,
  color,
  testID,
  hitSlop,
}: {
  href: string;
  children: string;
  style?: StyleProp<TextStyle>;
  color: string;
  testID?: string;
  /** Reach a 44 pt touch target on a phone for a link set on its own line. */
  hitSlop?: Insets;
}) {
  const ui = useUI();
  return (
    <Pressable role="link" onPress={() => void Linking.openURL(href)} testID={testID} hitSlop={hitSlop} style={({ pressed }) => [styles.link, pressed && { opacity: PRESS_OPACITY }]}>
      <Text style={style}>{children}</Text>
      <ui.Icon name="arrow-square-out" size={14} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({ link: { flexDirection: "row", alignItems: "center", gap: 4 } });
