"use client";

import { StyleSheet, Text, View } from "react-native";

import { groupEditDraft } from "@/lib/group-form";
import { updateGroup } from "@/lib/group-writes";
import type { HouseholdStore } from "@/lib/household-store";
import { CHILD_PHONES_COPY, ME_PAGE_COPY as COPY, mePhones } from "@/lib/pair-device";
import type { Group, PairedPhone } from "@/lib/types";

import { Alert } from "./Alert";
import { PairedPhoneRow } from "./PairedDevices";
import { useUI } from "./UIContext";

function useText() {
  const ui = useUI();
  return (size: number, lineHeight: number, token: string) => ({ fontFamily: ui.font, fontSize: size, lineHeight, color: ui.color(token) });
}

function CardHead({ title, sub }: { title: string; sub: string }) {
  const ui = useUI();
  const text = useText();
  return (
    <View style={[styles.head, { borderBottomColor: ui.color("hairline-card") }]}>
      <Text role="heading" aria-level={2} style={[text(14, 21, "ink"), styles.bold]}>
        {title}
      </Text>
      <Text style={text(14, 21, "ink-2")}>{sub}</Text>
    </View>
  );
}

/**
 * Pair FamilyFi Me's paired devices, as every client shows them: the FamilyFi Me phones and their Watches
 * still paired (`mePhones`), each drawn as Pair Device draws a phone, with whom it is for and Revoke. Pairing needs a
 * published route (`canPair`), so without one it says so. Until the phones have loaded it says so, and
 * a failed load offers Try again (`status`). Revoke asks first where the platform does.
 */
export function MePhonesCard({
  phones,
  canPair,
  status,
  onRevoke,
  onRetry,
  disabled,
}: {
  phones: readonly PairedPhone[];
  canPair: boolean;
  status: "loading" | "failed" | "ready";
  onRevoke: (phone: PairedPhone) => void;
  onRetry: () => void;
  disabled?: boolean;
}) {
  const ui = useUI();
  const text = useText();
  const paired = mePhones(phones);
  return (
    <View style={[styles.card, { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") }]} testID="me-phones">
      <CardHead title={COPY.phones} sub={COPY.phonesSub} />
      {status === "failed" ? (
        <View style={styles.empty}>
          <Alert tone="danger" action={{ label: CHILD_PHONES_COPY.tryAgain, onPress: onRetry, testID: "me-phones-retry" }}>
            {CHILD_PHONES_COPY.loadFailed}
          </Alert>
        </View>
      ) : status === "loading" ? (
        <Text style={[text(14, 21, "muted"), styles.empty]}>{CHILD_PHONES_COPY.loading}</Text>
      ) : (
        <>
          {/* Why Pair FamilyFi Me is off, with phones listed or not. */}
          {!canPair ? <Text style={[text(14, 21, "muted"), styles.empty]}>{CHILD_PHONES_COPY.remoteFirst}</Text> : null}
          {paired.length === 0 ? <Text style={[text(14, 21, "muted"), styles.empty]}>{COPY.empty}</Text> : null}
          {paired.map((phone) => (
            <PairedPhoneRow
              key={phone.id}
              phone={phone}
              parentName={phones.find((parent) => parent.id === phone.parentDeviceId)?.displayName}
              disabled={disabled}
              onRevoke={() => onRevoke(phone)}
            />
          ))}
        </>
      )}
    </View>
  );
}

/**
 * The Things everyone with FamilyFi Me sees and can ask about: each Things group's one switch, the
 * same one as its Edit sheet's (`kidsCanAsk`).
 */
export function SharedThingsCard({ groups, mutate, disabled }: { groups: readonly Group[]; mutate: Mutate; disabled?: boolean }) {
  const ui = useUI();
  const text = useText();
  const things = groups.filter((group) => group.kind === "things");
  return (
    <View style={[styles.card, { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") }]} testID="me-shared-things">
      <CardHead title={COPY.shared} sub={COPY.sharedSub} />
      {things.length === 0 ? <Text style={[text(14, 21, "muted"), styles.empty]}>{COPY.noThings}</Text> : null}
      {things.map((group, index) => (
        <View key={group.id} style={[styles.thing, index > 0 && { borderTopWidth: 1, borderTopColor: ui.color("hairline") }]}>
          <Text style={[text(14, 21, "ink"), styles.bold, styles.grow]}>{group.name}</Text>
          <ui.Toggle
            label={`Show ${group.name} in FamilyFi Me`}
            on={group.kidsCanAsk ?? false}
            disabled={disabled}
            onToggle={() => void updateGroup(mutate, group, { ...groupEditDraft(group), kidsCanAsk: !(group.kidsCanAsk ?? false) })}
            testID={`me-shared-${group.id}`}
          />
        </View>
      ))}
    </View>
  );
}

type Mutate = HouseholdStore["mutate"];

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  head: { gap: 2, paddingHorizontal: 18, paddingVertical: 15, borderBottomWidth: 1 },
  bold: { fontWeight: "600" },
  grow: { flex: 1, minWidth: 0 },
  empty: { paddingHorizontal: 18, paddingVertical: 16 },
  thing: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 10, minHeight: 52 },
});
