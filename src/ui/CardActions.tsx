"use client";

import { useEffect, useRef, useState, type ComponentRef } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { CARD_MENU_ROW_MIN, cardMenuPlacement, type Box } from "@/lib/card-menu";

import { PRESS_OPACITY, useUI } from "./UIContext";

export type ZoneAction = {
  label: string;
  onPress: () => void;
  strong?: boolean;
  disabled?: boolean;
  /** For UI tests: `data-testid` on the web, the accessibility identifier natively. */
  testID?: string;
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

/**
 * A group card's strong button with a dropdown beside it: the button runs `action`, and the caret
 * shows `menu` under it as a disclosure, a list of buttons in tab order. A choice closes it, hands
 * focus back to the caret, and runs, so a sheet it opens returns focus there; Escape and a click
 * elsewhere close it on the web. On a phone it opens over the whole screen, so a tap anywhere outside
 * it closes it (and does nothing else), as does Back on Android. `onOpenChange` lets the card raise
 * itself over the cards below.
 */
export function CardMenuButton({
  action,
  menu,
  menuLabel,
  align = "right",
  onOpenChange,
}: {
  action: ZoneAction;
  menu: ZoneAction[];
  /** The caret's name for assistive technology. */
  menuLabel: string;
  /** Which edge of the button the dropdown lines up with: the right in a card's corner, the left under its header. */
  align?: "left" | "right";
  onOpenChange?: (open: boolean) => void;
}) {
  const ui = useUI();
  const [open, setOpenState] = useState(false);
  const frame = useRef<ComponentRef<typeof View>>(null);
  const caret = useRef<ComponentRef<typeof Pressable>>(null);
  const split = useRef<ComponentRef<typeof View>>(null);
  const screen = useWindowDimensions();
  // On a phone: the button's frame in the window when the dropdown opened, and a choice waiting
  // for the dropdown to leave the screen, so the sheet it opens never races its dismissal on iOS.
  const [anchor, setAnchor] = useState<(Box & { screen: { width: number; height: number } }) | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const native = Platform.OS !== "web";
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (!open || Platform.OS !== "web") return;
    const node = frame.current as unknown as HTMLElement | null;
    const close = (refocus: boolean) => {
      setOpenState(false);
      onOpenChange?.(false);
      if (refocus) (caret.current as unknown as HTMLElement | null)?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (node && !node.contains(event.target as Node)) close(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  // The dropdown is placed for the screen it opened on; after a rotation or resize it is gone.
  const placed = open && anchor !== null && anchor.screen.width === screen.width && anchor.screen.height === screen.height;

  const shown = native ? placed : open;

  const toggle = () => {
    if (!native || placed) return setOpen(!open);
    split.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height, screen: { width: screen.width, height: screen.height } });
      setOpen(true);
    });
  };
  const choose = (item: ZoneAction) => {
    setOpen(false);
    // Focus goes back to the caret before the choice runs, so the sheet it opens returns it there.
    if (!native) (caret.current as unknown as HTMLElement | null)?.focus();
    // iOS presents nothing new until the dropdown's own screen has gone (`onDismiss`).
    if (Platform.OS === "ios") pending.current = item.onPress;
    else item.onPress();
  };
  const runPending = () => {
    const run = pending.current;
    pending.current = null;
    run?.();
  };

  const fill = ui.color(action.disabled ? "disabled" : "accent");
  const ink = ui.color("ink-on-fill");
  const label = { fontFamily: ui.font, fontSize: 14, lineHeight: 21, fontWeight: "600" as const, color: ink };
  // A phone's choice reads at its action size, 16; the web's at 14, as every other card action.
  const itemSize = Platform.OS === "web" ? 14 : 16;
  const items = menu.map((item, index) => (
    <Pressable
      key={item.testID ?? item.label}
      role="button"
      aria-disabled={item.disabled}
      disabled={item.disabled}
      onPress={() => choose(item)}
      testID={item.testID}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.menuItem,
        index > 0 && { borderTopWidth: 1, borderTopColor: ui.color("hairline-card") },
        hovered && { backgroundColor: ui.color("field-soft") },
        pressed && { opacity: PRESS_OPACITY },
      ]}
    >
      <Text style={{ fontFamily: ui.font, fontSize: itemSize, lineHeight: itemSize + 6, color: ui.color(item.disabled ? "disabled" : "ink") }}>{item.label}</Text>
    </Pressable>
  ));
  return (
    <View ref={frame} style={{ alignItems: align === "right" ? "flex-end" : "flex-start" }}>
      <View ref={split} style={[styles.split, { backgroundColor: fill }]}>
        <Pressable
          role="button"
          aria-disabled={action.disabled}
          hitSlop={{ top: 6, bottom: 6 }}
          disabled={action.disabled}
          onPress={action.onPress}
          testID={action.testID}
          style={({ pressed }) => [styles.splitMain, pressed && { opacity: PRESS_OPACITY }]}
        >
          <Text style={label}>{action.label}</Text>
        </Pressable>
        <View style={[styles.splitRule, { backgroundColor: ink }]} />
        <Pressable
          ref={caret}
          role="button"
          aria-label={menuLabel}
          aria-expanded={shown}
          aria-disabled={action.disabled}
          disabled={action.disabled}
          hitSlop={{ top: 6, bottom: 6 }}
          onPress={toggle}
          testID={action.testID ? `${action.testID}-menu` : undefined}
          style={({ pressed }) => [styles.splitCaret, pressed && { opacity: PRESS_OPACITY }]}
        >
          <ui.Icon name={shown ? "caret-up" : "caret-down"} size={14} color={ink} />
        </Pressable>
      </View>
      {open && !native ? (
        <View
          style={[
            styles.menu,
            styles.menuUnder,
            align === "right" ? { right: 0 } : { left: 0 },
            { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card"), boxShadow: ui.shadow("toast") },
          ]}
        >
          {items}
        </View>
      ) : null}
      {native ? (
        <Modal
          visible={placed}
          transparent
          animationType="none"
          statusBarTranslucent
          navigationBarTranslucent
          supportedOrientations={["portrait", "portrait-upside-down", "landscape"]}
          onRequestClose={() => setOpen(false)}
          onDismiss={runPending}
        >
          {/* A tap outside the dropdown closes it and goes no further. */}
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessible={false} testID={action.testID ? `${action.testID}-menu-outside` : undefined} />
          {anchor ? (
            <View
              onAccessibilityEscape={() => setOpen(false)}
              style={[
                styles.menu,
                cardMenuPlacement(anchor, screen, align),
                { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card"), boxShadow: ui.shadow("toast") },
              ]}
            >
              {items}
            </View>
          ) : null}
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minHeight: 32, justifyContent: "center" },
  split: { flexDirection: "row", borderRadius: 8, overflow: "hidden", minHeight: 32 },
  splitMain: { paddingHorizontal: 10, paddingVertical: 6, justifyContent: "center" },
  splitRule: { width: 1, opacity: 0.35 },
  // 44 to touch on a phone; the web keeps the caret narrow.
  splitCaret: { paddingHorizontal: 8, justifyContent: "center", alignItems: "center", minWidth: Platform.OS === "web" ? 0 : 44 },
  menu: { position: "absolute", zIndex: 10, minWidth: 240, borderRadius: 10, borderWidth: 1, paddingVertical: 4 },
  // Under the button whatever its height, which grows with large text.
  menuUnder: { top: "100%", marginTop: 6 },
  // At least 44 to touch on a phone; the web keeps 14/10.
  menuItem: { paddingHorizontal: 14, paddingVertical: 10, justifyContent: "center", minHeight: Platform.OS === "web" ? 0 : CARD_MENU_ROW_MIN },
});
