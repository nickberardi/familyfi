"use client";

import { Pressable, StyleSheet, Text, View } from "react-native";

import { CHILD_PHONES_COPY as COPY } from "@/lib/pair-device";
import type { Group, PairedPhone } from "@/lib/types";

import { Alert } from "./Alert";
import { PairedPhoneRow } from "./PairedDevices";
import { PRESS_OPACITY, useUI } from "./UIContext";
import { useLargeText } from "./use-large-text";

/**
 * A family member's FamilyFi Me phones on their page, as every client shows them: each one as Pair
 * Device lists it, with Revoke, and Pair FamilyFi Me for a phone of theirs, which needs a published
 * route (`canPair`). Until the phones and remote access have loaded it says so, and a failed load
 * offers Try again (`status`), so it never claims remote access is off before it knows. Each
 * callback asks first where the platform does.
 */
export function ChildPhonesCard({
  group,
  phones,
  canPair,
  status,
  onPair,
  onRevoke,
  onRetry,
  disabled,
}: {
  group: Pick<Group, "name">;
  /** This family member's FamilyFi Me phones still paired (`childPhonesOf`). */
  phones: PairedPhone[];
  canPair: boolean;
  /** Whether the phones and remote access have loaded, are loading, or failed to load. */
  status: "loading" | "failed" | "ready";
  onPair: () => void;
  onRevoke: (phone: PairedPhone) => void;
  onRetry: () => void;
  disabled?: boolean;
}) {
  const ui = useUI();
  const text = { fontFamily: ui.font, fontSize: 14, lineHeight: 21 };
  const off = disabled || !canPair || status !== "ready";
  // At large text the heading and Pair FamilyFi Me stack, as the devices card's do.
  const large = useLargeText();
  return (
    <View style={[styles.card, { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") }]} testID="child-phones">
      <View style={[styles.head, large && styles.headStacked, { borderBottomColor: phones.length ? "transparent" : ui.color("hairline-card") }]}>
        <Text role="heading" aria-level={2} style={[text, styles.title, !large && styles.titleBeside, { color: ui.color("ink") }]}>
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
      {status === "failed" ? (
        <View style={styles.empty}>
          <Alert tone="danger" action={{ label: COPY.tryAgain, onPress: onRetry, testID: "child-phones-retry" }}>
            {COPY.loadFailed}
          </Alert>
        </View>
      ) : status === "loading" ? (
        <Text style={[text, styles.empty, { color: ui.color("muted") }]}>{COPY.loading}</Text>
      ) : phones.length === 0 ? (
        <Text style={[text, styles.empty, { color: ui.color("muted") }]}>{canPair ? COPY.empty(group.name) : COPY.remoteFirst}</Text>
      ) : (
        phones.map((phone) => <PairedPhoneRow key={phone.id} phone={phone} disabled={disabled} onRevoke={() => onRevoke(phone)} />)
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 18, paddingVertical: 4, borderBottomWidth: 1 },
  headStacked: { flexDirection: "column", alignItems: "flex-start", gap: 0, paddingTop: 12 },
  title: { fontWeight: "600" },
  titleBeside: { flex: 1 },
  touch: { minHeight: 44, justifyContent: "center" },
  empty: { paddingHorizontal: 18, paddingVertical: 16 },
});
