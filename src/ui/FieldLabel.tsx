"use client";

import { Text } from "react-native";

import { useUI } from "./UIContext";

/**
 * The label over a form's control, as the web's sheets set it. Screen readers skip it: the control
 * carries the same name, and would otherwise be announced twice.
 */
export function FieldLabel({ children }: { children: string }) {
  const ui = useUI();
  return <Text aria-hidden style={{ fontFamily: ui.font, fontSize: 12, lineHeight: 18, fontWeight: "600", marginBottom: 6, color: ui.color("ink-3") }}>{children}</Text>;
}
