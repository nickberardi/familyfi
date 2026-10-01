"use client";

import { Text } from "react-native";

import { useUI } from "./UIContext";

/** The label over a form's control, as the web's sheets set it. */
export function FieldLabel({ children }: { children: string }) {
  const ui = useUI();
  return <Text style={{ fontFamily: ui.font, fontSize: 12, lineHeight: 18, fontWeight: "600", marginBottom: 6, color: ui.color("ink-3") }}>{children}</Text>;
}
