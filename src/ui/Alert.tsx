"use client";

import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { IconName } from "@/lib/icons";

import { PRESS_OPACITY, useUI } from "./UIContext";

/**
 * A notice that asks for attention and stays until its condition clears, in four tones:
 * `warning` for a condition or a consequence to know about, `danger` for an error, `info` and
 * `success` for news. An explanation that asks nothing of anyone stays a plain grey note. The
 * tint is laid over the card colour, so an Alert looks the same on the page and inside a card.
 */
export type AlertTone = "info" | "success" | "warning" | "danger";

const TONES: Record<AlertTone, { ink: string; fill: string; line: string; icon: IconName }> = {
  info: { ink: "accent", fill: "accent-fill", line: "accent-line", icon: "info" },
  success: { ink: "on-ink", fill: "on-tint", line: "on-tint", icon: "check-circle" },
  warning: { ink: "paused", fill: "paused-fill", line: "paused-line", icon: "warning" },
  danger: { ink: "danger", fill: "danger-fill", line: "danger-tint", icon: "warning" },
};

export function Alert({
  tone,
  title,
  children,
  action,
  role,
  testID,
}: {
  tone: AlertTone;
  /** A short first line, in the page's ink: the icon carries the tone, and the tone's own ink is too light on its wash. */
  title?: string;
  /** The body: one or two plain sentences. */
  children?: ReactNode;
  /** One text action, such as "Show them" or "Try again". */
  action?: { label: string; onPress: () => void; pressed?: boolean; testID?: string };
  /** `alert` for an error that just happened, `status` for a condition shown as the page loads. */
  role?: "alert" | "status";
  testID?: string;
}) {
  const ui = useUI();
  const tint = TONES[tone];
  const body = typeof children === "string" ? <Text style={[styles.body, { fontFamily: ui.font, color: ui.color(title ? "ink-2" : "ink") }]}>{children}</Text> : children;
  return (
    <View style={[styles.ground, { backgroundColor: ui.color("card") }]} role={role} testID={testID}>
      <View style={[styles.alert, { backgroundColor: ui.color(tint.fill), borderColor: ui.color(tint.line) }]}>
        <View aria-hidden style={styles.icon}>
          <ui.Icon name={tint.icon} size={17} color={ui.color(tint.ink)} />
        </View>
        <View style={styles.grow}>
          {title ? <Text style={[styles.title, { fontFamily: ui.font, color: ui.color("ink") }]}>{title}</Text> : null}
          {body}
          {action ? (
            <Pressable
              role="button"
              aria-pressed={action.pressed}
              onPress={action.onPress}
              testID={action.testID}
              style={({ pressed }) => [styles.action, pressed && { opacity: PRESS_OPACITY }]}
            >
              <Text style={[styles.actionLabel, { fontFamily: ui.font, color: ui.color("accent") }]}>{action.label}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ground: { borderRadius: 10 },
  alert: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  icon: { paddingTop: 2 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 14, lineHeight: 21, fontWeight: "600" },
  body: { fontSize: 14, lineHeight: 20 },
  action: { alignSelf: "flex-start", marginTop: 4 },
  actionLabel: { fontSize: 14, lineHeight: 21, fontWeight: "600" },
});
