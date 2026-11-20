"use client";

import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { remoteStatus, routeTrust, transportLabel } from "@/lib/connection-routes";
import { canRepair, isApp, isAppControls, PAIR_COPY as COPY, pairDeviceList, PHONES_SHOWN, phoneLines, revokedToggleLabel, showAllLabel, splitPhones } from "@/lib/pair-device";
import type { ConnectionRoute, PairedPhone, RemoteAccess } from "@/lib/types";

import { Tag } from "./Tag";
import { useLargeText } from "./use-large-text";
import { PRESS_OPACITY, tokenOf, useUI } from "./UIContext";

const MONO = Platform.select({ web: "var(--font-mono)", ios: "Menlo", default: "monospace" });

function useText() {
  const ui = useUI();
  return (size: number, lineHeight: number, token: string) => ({ fontFamily: ui.font, fontSize: size, lineHeight, color: ui.color(token) });
}

export function TextButton({ label, token, onPress, disabled, testID }: { label: string; token: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  const text = useText();
  return (
    <Pressable
      role="button"
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.textButton, disabled && { opacity: 0.4 }, pressed && !disabled && { opacity: PRESS_OPACITY }]}
    >
      <Text style={[text(14, 21, token), styles.bold]}>{label}</Text>
    </Pressable>
  );
}

/**
 * One paired device (an app, its Siri and shortcuts, a Watch or an agent), each the same: what it may do and whose account it acts as, how
 * it reaches home, when it paired and its sign-in ends, and what can be done to it on the right.
 */
export function PairedPhoneRow({
  phone,
  parentName = null,
  onRevoke,
  onRepair,
  onRemove,
  disabled,
}: {
  phone: PairedPhone;
  /** The name of the app that set this device up: a Watch's, or its own Siri and shortcuts'. */
  parentName?: string | null;
  /** No changes while the phone's view of the household is stale. */
  disabled?: boolean;
  onRevoke?: () => void;
  onRepair?: () => void;
  onRemove?: () => void;
}) {
  const ui = useUI();
  const text = useText();
  const lines = phoneLines(phone, new Date(), parentName);
  // At large text the actions go under the words, so the name and address keep the row's width.
  const large = useLargeText();
  const actions =
    onRevoke || onRepair || onRemove ? (
      <View style={large ? styles.actionsUnder : styles.actions}>
        {onRevoke ? <TextButton label={COPY.revoke} token="danger" onPress={onRevoke} disabled={disabled} testID={`phone-revoke-${phone.id}`} /> : null}
        {onRepair ? <TextButton label={COPY.repair} token="accent" onPress={onRepair} disabled={disabled} testID={`phone-repair-${phone.id}`} /> : null}
        {onRemove ? <TextButton label={COPY.remove} token="danger" onPress={onRemove} disabled={disabled} testID={`phone-remove-${phone.id}`} /> : null}
      </View>
    ) : null;
  return (
    <View style={[styles.phone, large && styles.phoneLarge, { borderTopWidth: 1, borderTopColor: ui.color("hairline") }]} testID="phone-row">
      <View style={[styles.phoneIcon, { backgroundColor: ui.color("field") }]}>
        <ui.Icon name={phone.clientType === "app-watch" ? "watch" : phone.clientType === "agent" ? "robot" : "device-mobile"} size={18} color={ui.color("ink")} />
      </View>
      <View style={styles.phoneWords}>
        <View style={styles.nameRow}>
          <Text style={[text(14, 21, "ink"), styles.bold, styles.name]}>{phone.displayName}</Text>
          {lines.tags.map((tag) => (
            <Tag key={tag.name} label={tag.label === tag.name ? undefined : tag.name} tone={tag.tone}>
              {tag.label}
            </Tag>
          ))}
        </View>
        <Text style={[text(14, 21, "muted"), styles.line]}>{lines.access}</Text>
        <Text style={[text(14, 21, "muted"), styles.line]}>
          {lines.via ? (
            <>
              via <Text style={{ fontFamily: MONO }}>{lines.via.url}</Text> · {lines.via.transport}
            </>
          ) : (
            lines.origin
          )}
        </Text>
        <Text style={[text(14, 21, "muted"), styles.line]}>{lines.dates}</Text>
        {lines.expired ? (
          <Text style={[text(14, 21, "danger"), styles.bold, styles.line]}>{isApp(phone) ? COPY.expired : isAppControls(phone) ? COPY.expiredControls : COPY.expiredPairAgain}</Text>
        ) : null}
        {large ? actions : null}
      </View>
      {large ? null : actions}
    </View>
  );
}

/**
 * The household's paired phones, Watches and agents, most recently seen first, with revoked ones folded
 * away. FamilyFi Me phones still paired are Pair FamilyFi Me's (`pairDeviceList`); revoked ones stay here to remove. Any phone but this one can be re-paired, active or revoked. Each callback asks first where the
 * platform does, then makes the change.
 */
export function PairedDevicesCard({
  phones,
  selfId,
  canPair,
  onRevoke,
  onRepair,
  onRemove,
  onRemoveAllRevoked,
  disabled,
}: {
  phones: PairedPhone[];
  /** The paired device showing this card, which cannot re-pair itself mid-flow. */
  selfId?: string | null;
  /** No changes while the phone's view of the household is stale. */
  disabled?: boolean;
  /** Whether a route is published, so a phone can pair (or re-pair) now. */
  canPair: boolean;
  onRevoke: (phone: PairedPhone) => void;
  onRepair: (phone: PairedPhone) => void;
  onRemove: (phone: PairedPhone) => void;
  onRemoveAllRevoked: (count: number) => void;
}) {
  const ui = useUI();
  const text = useText();
  const [showAll, setShowAll] = useState(false);
  const [showRevoked, setShowRevoked] = useState(false);
  const { active, revoked } = splitPhones(pairDeviceList(phones));
  const nameOf = (id: string | null) => phones.find((phone) => phone.id === id)?.displayName ?? null;
  const repair = (phone: PairedPhone) => (canRepair(phone, { canPair, selfId }) ? () => onRepair(phone) : undefined);
  const rule = { borderTopWidth: 1, borderTopColor: ui.color("hairline") };
  return (
    <View style={[styles.card, { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") }]} testID="paired-devices">
      <View style={[styles.head, { borderBottomColor: ui.color("hairline-card") }]}>
        <Text style={[text(14, 21, "ink"), styles.bold]}>{COPY.paired}</Text>
        <Text style={text(14, 21, "ink-2")}>{COPY.pairedSub}</Text>
      </View>
      {active.length === 0 ? (
        <Text style={[text(14, 21, "muted"), styles.empty]}>
          {canPair ? COPY.noPhones : COPY.remoteFirst}
        </Text>
      ) : (
        (showAll ? active : active.slice(0, PHONES_SHOWN)).map((phone) => (
          <PairedPhoneRow
            key={phone.id}
            phone={phone}
            parentName={nameOf(phone.parentDeviceId)}
            disabled={disabled}
            onRevoke={() => onRevoke(phone)}
            onRepair={repair(phone)}
          />
        ))
      )}
      {active.length > PHONES_SHOWN ? (
        <Pressable role="button" onPress={() => setShowAll((value) => !value)} style={[styles.listButton, rule]} testID="phones-show-all">
          <Text style={[text(14, 21, "accent"), styles.bold]}>{showAll ? COPY.showRecent : showAllLabel(active.length)}</Text>
        </Pressable>
      ) : null}
      {revoked.length ? (
        <View style={rule}>
          <Pressable role="button" aria-expanded={showRevoked} onPress={() => setShowRevoked((value) => !value)} style={styles.listButton} testID="phones-show-revoked">
            <Text style={[text(14, 21, "accent"), styles.bold]}>{revokedToggleLabel(showRevoked, revoked.length)}</Text>
          </Pressable>
          {showRevoked ? (
            <>
              {revoked.map((phone) => (
                <PairedPhoneRow
                  key={phone.id}
                  phone={phone}
                  parentName={nameOf(phone.parentDeviceId)}
                  disabled={disabled}
                  onRepair={repair(phone)}
                  onRemove={() => onRemove(phone)}
                />
              ))}
              <View style={[styles.listButton, rule]}>
                <TextButton label={COPY.removeAllRevoked} token="danger" onPress={() => onRemoveAllRevoked(revoked.length)} disabled={disabled} testID="phones-remove-revoked" />
              </View>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Remote access as a client that cannot change it shows it: whether it is on, the one address
 * phones use and how they trust it, and where to change it.
 */
export function RemoteAccessSummary({ tunnel, published }: { tunnel: RemoteAccess | null; published: ConnectionRoute | null }) {
  const ui = useUI();
  const text = useText();
  const status = remoteStatus(tunnel);
  return (
    <View style={[styles.card, { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") }]} testID="remote-access-summary">
      <View style={[styles.head, styles.remoteHead, { borderBottomColor: ui.color("hairline-card") }]}>
        <View style={styles.grow}>
          <Text style={[text(14, 21, "ink"), styles.bold]}>{COPY.remote}</Text>
          <Text style={[text(14, 21, "muted"), styles.line]}>{COPY.remoteSub}</Text>
        </View>
        <Text style={[text(14, 21, tokenOf(status.ink)), styles.bold]} testID="remote-status">
          {status.label}
        </Text>
      </View>
      <View style={styles.remoteBody}>
        {published ? (
          <View>
            <Text style={[text(14, 21, "ink"), { fontFamily: MONO }]} testID="remote-url">
              {published.url}
            </Text>
            <Text style={[text(14, 21, "muted"), styles.line]}>
              {transportLabel(published.transport)} · {routeTrust(published)}
            </Text>
            {status.detail ? (
              <Text style={[text(14, 21, "muted"), styles.line]} testID="remote-detail">
                {status.detail}
              </Text>
            ) : null}
          </View>
        ) : (
          <Text style={text(14, 21, "muted")}>{COPY.remoteOff}</Text>
        )}
        <Text style={text(14, 21, "muted")}>{COPY.remoteOnWeb}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  head: { gap: 2, paddingHorizontal: 18, paddingVertical: 15, borderBottomWidth: 1 },
  remoteHead: { alignItems: "center", gap: 12 },
  bold: { fontWeight: "600" },
  regular: { fontWeight: "400" },
  grow: { flex: 1, minWidth: 200 },
  line: { marginTop: 2 },
  empty: { paddingHorizontal: 18, paddingVertical: 16 },
  phone: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 12 },
  phoneIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  phoneWords: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 8, rowGap: 4 },
  name: { flexShrink: 1 },
  actions: { flexShrink: 0, alignItems: "flex-end", gap: Platform.OS === "web" ? 4 : 0 },
  phoneLarge: { alignItems: "flex-start" },
  // Side by side under the words.
  actionsUnder: { flexDirection: "row", flexWrap: "wrap", columnGap: 20 },
  // 44 to touch on a phone, the line centred in it; the web keeps the line's own height.
  textButton: { minHeight: Platform.OS === "web" ? 0 : 44, justifyContent: "center" },
  listButton: { paddingHorizontal: 18, paddingVertical: 10 },
  remoteBody: { gap: 12, paddingHorizontal: 18, paddingVertical: 12 },
});
