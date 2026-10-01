"use client";

import { Text } from "react-native";

import { tokenOf, useUI } from "./UIContext";

const SIZES = {
  /** A list row's chip. */
  row: { fontSize: 11.5, lineHeight: 17.25, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  /** The category page's chip. */
  detail: { fontSize: 12.5, lineHeight: 18.75, paddingHorizontal: 11, paddingVertical: 5, borderRadius: 10 },
  /** A network's or server's result. */
  small: { fontSize: 11, lineHeight: 16.5, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
} as const;

/** What a DNS check found, as a tinted chip (`verdictStyle` or `domainVerdictStyle` in `upstream.ts`). */
export function VerdictChip({ style, size = "row", testID }: { style: { label: string; ink: string; fill: string; line: string }; size?: keyof typeof SIZES; testID?: string }) {
  const ui = useUI();
  return (
    <Text
      testID={testID}
      style={[
        SIZES[size],
        {
          flexShrink: 0,
          overflow: "hidden",
          borderWidth: 1,
          fontFamily: ui.font,
          fontWeight: "600",
          backgroundColor: ui.color(tokenOf(style.fill)),
          color: ui.color(tokenOf(style.ink)),
          borderColor: ui.color(tokenOf(style.line)),
        },
      ]}
    >
      {style.label}
    </Text>
  );
}
