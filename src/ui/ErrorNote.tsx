"use client";

import { StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";

import type { ErrorNotice } from "@/lib/api-client";

import { ExternalLink } from "./ExternalLink";
import { useUI } from "./UIContext";

/**
 * A failed action's message, in the caller's danger style, with the error's link beneath it when
 * it has one, such as the demo's "Set up your own".
 */
export function ErrorNote({ notice, style, testID }: { notice: ErrorNotice; style: StyleProp<TextStyle>; testID?: string }) {
  const ui = useUI();
  if (!notice.link) return <Text style={style} testID={testID}>{notice.text}</Text>;
  return (
    <View style={styles.note} testID={testID}>
      <Text style={style}>{notice.text}</Text>
      <ExternalLink
        href={notice.link.url}
        style={[styles.link, { fontFamily: ui.font, color: ui.color("accent") }]}
        color={ui.color("accent")}
        testID={testID ? `${testID}-link` : "error-link"}
      >
        {notice.link.label}
      </ExternalLink>
    </View>
  );
}

const styles = StyleSheet.create({
  note: { gap: 4, alignItems: "flex-start" },
  link: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
});
