"use client";

import { StyleSheet, Text, View } from "react-native";

import { groupEditDraft } from "@/lib/group-form";
import { updateGroup } from "@/lib/group-writes";
import type { HouseholdStore } from "@/lib/household-store";
import { personMonogram } from "@/lib/internet-zone";
import { CHILD_PHONES_COPY, ME_PAGE_COPY as COPY, mePeople } from "@/lib/pair-device";
import type { Group, PairedPhone } from "@/lib/types";

import { Alert } from "./Alert";
import { PairedPhoneRow, TextButton } from "./PairedDevices";
import { useUI } from "./UIContext";
import { useLargeText } from "./use-large-text";

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
 * Pair FamilyFi Me's people, as every client shows them: everyone with a FamilyFi Me phone and every
 * child or teen without one (`mePeople`), each with Pair a device and their phones as Pair Device lists
 * them, with Revoke. Pairing needs a published route (`canPair`). Until the phones have loaded it says
 * so, and a failed load offers Try again (`status`). Each callback asks first where the platform does.
 */
export function MePeopleCard({
  groups,
  phones,
  canPair,
  status,
  onPair,
  onRevoke,
  onRetry,
  disabled,
}: {
  groups: readonly Group[];
  phones: readonly PairedPhone[];
  canPair: boolean;
  status: "loading" | "failed" | "ready";
  onPair: (group: Group) => void;
  onRevoke: (phone: PairedPhone) => void;
  onRetry: () => void;
  disabled?: boolean;
}) {
  const ui = useUI();
  const text = useText();
  const large = useLargeText();
  const people = mePeople(groups, phones);
  const off = disabled || !canPair || status !== "ready";
  const anyFamily = groups.some((group) => group.kind === "family");
  return (
    <View style={[styles.card, { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") }]} testID="me-people">
      <CardHead title={COPY.people} sub={COPY.peopleSub} />
      {status === "failed" ? (
        <View style={styles.empty}>
          <Alert tone="danger" action={{ label: CHILD_PHONES_COPY.tryAgain, onPress: onRetry, testID: "me-people-retry" }}>
            {CHILD_PHONES_COPY.loadFailed}
          </Alert>
        </View>
      ) : status === "loading" ? (
        <Text style={[text(14, 21, "muted"), styles.empty]}>{CHILD_PHONES_COPY.loading}</Text>
      ) : (
        <>
          {/* Why Pair a device is off, with phones listed or not. */}
          {!canPair ? <Text style={[text(14, 21, "muted"), styles.empty]}>{CHILD_PHONES_COPY.remoteFirst}</Text> : null}
          {people.length === 0 ? <Text style={[text(14, 21, "muted"), styles.empty]}>{anyFamily ? COPY.empty : COPY.noPeople}</Text> : null}
          {people.map(({ group, phones: own }, index) => (
            <View key={group.id} style={index > 0 || !canPair ? { borderTopWidth: 1, borderTopColor: ui.color("hairline") } : undefined} testID={`me-person-${group.id}`}>
              <View style={[styles.person, large && styles.personStacked]}>
                <View style={styles.personName}>
                  <View style={[styles.mark, { backgroundColor: ui.color("person-fill") }]} aria-hidden>
                    <Text maxFontSizeMultiplier={1.2} style={{ fontFamily: ui.font, fontWeight: "600", fontSize: personMonogram(group).length > 2 ? 12 : 15, color: ui.color("person-ink") }}>
                      {personMonogram(group)}
                    </Text>
                  </View>
                  <View style={styles.grow}>
                    <Text style={[text(14, 21, "ink"), styles.bold]}>{group.name}</Text>
                    {own.length === 0 ? <Text style={text(14, 21, "muted")}>{COPY.noPhone}</Text> : null}
                  </View>
                </View>
                <View style={styles.touch}>
                  <TextButton label={COPY.pairFor} accessibilityLabel={COPY.pairForLabel(group.name)} token="accent" onPress={() => onPair(group)} disabled={off} testID={`me-pair-${group.id}`} />
                </View>
              </View>
              {own.map((phone) => (
                <PairedPhoneRow key={phone.id} phone={phone} hidePerson disabled={disabled} onRevoke={() => onRevoke(phone)} />
              ))}
            </View>
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
  person: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 10 },
  personStacked: { flexDirection: "column", alignItems: "flex-start", gap: 0 },
  personName: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, minWidth: 0 },
  mark: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  touch: { minHeight: 44, justifyContent: "center" },
  thing: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 10, minHeight: 52 },
});
