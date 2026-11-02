"use client";

import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { PRESS_OPACITY, useUI } from "./UIContext";

export type ZoneAction = {
  label: string;
  onPress: () => void;
  strong?: boolean;
  disabled?: boolean;
  /** For UI tests: `data-testid` on the web, the accessibility identifier natively. */
  testID?: string;
  /** PROTOTYPE: a dropdown of choices; the button's own tap runs the first. */
  menu?: ZoneAction[];
};

/** A group card's button: the header's Block, Unblock or Resume (strong), or a rule area's Pause or Resume. */
export function CardButton({ action }: { action: ZoneAction }) {
  const ui = useUI();
  return (
    <Pressable
      role="button"
      aria-disabled={action.disabled}
      // 44 pt to touch on a phone; react-native-web ignores it, so the web is unchanged.
      hitSlop={{ top: 6, bottom: 6 }}
      disabled={action.disabled}
      onPress={action.onPress}
      testID={action.testID}
      style={({ pressed }) => [
        styles.button,
        action.strong
          ? { backgroundColor: ui.color(action.disabled ? "disabled" : "accent") }
          : { backgroundColor: ui.color("card"), borderWidth: 1, borderColor: ui.color("control-line"), paddingHorizontal: 9, paddingVertical: 5 },
        pressed && { opacity: PRESS_OPACITY },
      ]}
    >
      <Text
        style={{
          fontFamily: ui.font,
          fontSize: 14,
          lineHeight: 21,
          fontWeight: "600",
          color: action.strong ? ui.color("ink-on-fill") : ui.color(action.disabled ? "disabled" : "accent"),
        }}
      >
        {action.label}
      </Text>
    </Pressable>
  );
}

/** A text link on a card, such as More time. */
export function CardTextButton({ action }: { action: ZoneAction }) {
  const ui = useUI();
  return (
    <Pressable
      role="button"
      aria-disabled={action.disabled}
      hitSlop={{ top: 10, bottom: 10 }}
      disabled={action.disabled}
      onPress={action.onPress}
      testID={action.testID}
      style={({ pressed }) => [pressed && { opacity: PRESS_OPACITY }]}
    >
      <Text style={{ fontFamily: ui.font, fontSize: 14, lineHeight: 21, fontWeight: "600", color: ui.color(action.disabled ? "disabled" : "accent") }}>
        {action.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minHeight: 32, justifyContent: "center" },
});

/** PROTOTYPE: a split button, its action and a caret that opens its menu. */
export function CardMenuButton({ action, onOpenChange }: { action: ZoneAction; onOpenChange?: (open: boolean) => void }) {
  const ui = useUI();
  const [open, setOpen] = useState(false);
  const toggle = () => {
    setOpen(!open);
    onOpenChange?.(!open);
  };
  const ink = ui.color("ink-on-fill");
  return (
    <View style={{ alignItems: "flex-end" }}>
      <View style={{ flexDirection: "row", borderRadius: 8, overflow: "hidden", backgroundColor: ui.color("accent") }}>
        <Pressable role="button" onPress={action.onPress} testID={action.testID} style={{ paddingHorizontal: 10, paddingVertical: 6, minHeight: 32, justifyContent: "center" }}>
          <Text style={{ fontFamily: ui.font, fontSize: 14, lineHeight: 21, fontWeight: "600", color: ink }}>{action.label}</Text>
        </Pressable>
        <View style={{ width: 1, backgroundColor: ink, opacity: 0.35 }} />
        <Pressable role="button" aria-label="More choices" onPress={toggle} testID={`${action.testID}-menu`} style={{ paddingHorizontal: 8, justifyContent: "center" }}>
          <ui.Icon name={open ? "caret-up" : "caret-down"} size={14} color={ink} />
        </Pressable>
      </View>
      {open ? (
        <View
          style={{
            position: "absolute",
            top: 38,
            right: 0,
            zIndex: 10,
            minWidth: 280,
            borderRadius: 10,
            paddingVertical: 4,
            backgroundColor: ui.color("card"),
            borderWidth: 1,
            borderColor: ui.color("control-line"),
            boxShadow: "0 8px 24px rgba(0,0,0,0.16)",
          }}
        >
          {(action.menu ?? []).map((item, index) => (
            <Pressable key={item.label} role="menuitem" onPress={item.onPress} style={{ paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: index ? 1 : 0, borderTopColor: ui.color("hairline-card") }}>
              <Text style={{ fontFamily: ui.font, fontSize: 15, lineHeight: 21, fontWeight: "400", color: ui.color("ink") }}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
