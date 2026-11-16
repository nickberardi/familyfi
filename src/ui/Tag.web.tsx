"use client";

import type { TagTone } from "@/lib/pair-device";

import { TAG_TONES } from "./tag-tones";
import { useUI } from "./UIContext";

/**
 * The web's Tag (see Tag.tsx). A `label` is read in place of the word through visually hidden text,
 * since a screen reader ignores `aria-label` on an element with no role, which is what
 * react-native-web draws for text.
 */
export function Tag({ children, label, tone = "neutral" }: { children: string; label?: string; tone?: TagTone }) {
  const ui = useUI();
  const colors = TAG_TONES[tone];
  return (
    <span
      style={{
        flexShrink: 0,
        borderRadius: 6,
        padding: "1px 6px",
        fontSize: 14,
        lineHeight: "20px",
        fontWeight: 600,
        fontFamily: ui.font,
        color: ui.color(colors.ink),
        backgroundColor: ui.color(colors.fill),
        whiteSpace: "nowrap",
      }}
    >
      {label ? (
        <>
          <span aria-hidden="true">{children}</span>
          <span className="sr-only">{label}</span>
        </>
      ) : (
        children
      )}
    </span>
  );
}
