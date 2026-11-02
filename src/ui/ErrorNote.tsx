"use client";

import { StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";

import type { ErrorNotice } from "@/lib/api-client";

import { ExternalLink } from "./ExternalLink";
import { useUI } from "./UIContext";

/**
 * A failed action's message, announced as an alert, with the error's link beneath it when it has
 * one, such as the demo's "Set up your own". The text is 14 px danger unless `style` says otherwise.
 * One component for shared and web-only cards alike.
 */
export function ErrorNote({ notice, style, testID }: { notice: ErrorNotice; style?: StyleProp<TextStyle>; testID?: string }) {
  const ui = useUI();
  const text = [{ fontFamily: ui.font, fontSize: 14, lineHeight: 20, color: ui.color("danger") }, style];
  if (!notice.link) return <Text role="alert" style={text} testID={testID}>{notice.text}</Text>;
  return (
    <View role="alert" style={styles.note} testID={testID}>
      <Text style={text}>{notice.text}</Text>
      <ExternalLink
        href={notice.link.url}
        style={[styles.link, { fontFamily: ui.font, color: ui.color("accent") }]}
        color={ui.color("accent")}
        testID={testID ? `${testID}-link` : "error-link"}
        hitSlop={TOUCH}
      >
        {notice.link.label}
      </ExternalLink>
    </View>
  );
}

/** A 20 pt line reaches 44 pt to touch on a phone. */
const TOUCH = { top: 12, bottom: 12, left: 0, right: 8 };

const styles = StyleSheet.create({
  note: { gap: 4, alignItems: "flex-start" },
  link: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
});
