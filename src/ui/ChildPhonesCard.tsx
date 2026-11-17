"use client";

import { Pressable, StyleSheet, Text, View } from "react-native";

import { CHILD_PHONES_COPY as COPY } from "@/lib/pair-device";
import type { Group, PairedPhone } from "@/lib/types";

import { PairedPhoneRow } from "./PairedDevices";
import { PRESS_OPACITY, useUI } from "./UIContext";

/**
 * A family member's FamilyFi Me phones on their page, as every client shows them: each one as Pair
 * Device lists it, with Revoke, and Pair FamilyFi Me for a phone of theirs, which needs a published
 * route (`canPair`). Each callback asks first where the platform does.
 */
export function ChildPhonesCard({
  group,
  phones,
  canPair,
  onPair,
  onRevoke,
  disabled,
}: {
  group: Pick<Group, "name">;
  /** This family member's FamilyFi Me phones still paired (`childPhonesOf`). */
  phones: PairedPhone[];
  canPair: boolean;
  onPair: () => void;
  onRevoke: (phone: PairedPhone) => void;
  disabled?: boolean;
}) {
  const ui = useUI();
  const text = { fontFamily: ui.font, fontSize: 14, lineHeight: 21 };
  const off = disabled || !canPair;
  return (
    <View style={[styles.card, { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") }]} testID="child-phones">
      <View style={[styles.head, { borderBottomColor: phones.length ? "transparent" : ui.color("hairline-card") }]}>
        <Text role="heading" aria-level={2} style={[text, styles.title, { color: ui.color("ink") }]}>
          {COPY.title}
        </Text>
        <Pressable
          role="button"
          aria-disabled={off}
          disabled={off}
          onPress={onPair}
          testID="child-phones-pair"
          style={({ pressed }) => [styles.touch, off && { opacity: 0.4 }, pressed && !off && { opacity: PRESS_OPACITY }]}
        >
          <Text style={[text, styles.title, { color: ui.color("accent") }]}>{COPY.pair}</Text>
        </Pressable>
      </View>
      {phones.length === 0 ? (
        <Text style={[text, styles.empty, { color: ui.color("muted") }]}>{canPair ? COPY.empty(group.name) : COPY.remoteFirst}</Text>
      ) : (
        phones.map((phone) => <PairedPhoneRow key={phone.id} phone={phone} disabled={disabled} onRevoke={() => onRevoke(phone)} />)
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  head: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 10, paddingHorizontal: 18, paddingVertical: 4, borderBottomWidth: 1 },
  title: { fontWeight: "600", flexShrink: 1 },
  touch: { minHeight: 44, justifyContent: "center", marginLeft: "auto" },
  empty: { paddingHorizontal: 18, paddingVertical: 16 },
});
