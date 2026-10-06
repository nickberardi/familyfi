"use client";

import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { REMOTE_STATUS, routeTrust, transportLabel } from "@/lib/connection-routes";
import { PAIR_COPY as COPY, PHONES_SHOWN, phoneLines, revokedToggleLabel, showAllLabel, splitPhones } from "@/lib/pair-device";
import type { ConnectionRoute, PairedPhone, RemoteAccess } from "@/lib/types";

import { PRESS_OPACITY, tokenOf, useUI } from "./UIContext";

const MONO = Platform.select({ web: "var(--font-mono)", ios: "Menlo", default: "monospace" });

function useText() {
  const ui = useUI();
  return (size: number, lineHeight: number, token: string) => ({ fontFamily: ui.font, fontSize: size, lineHeight, color: ui.color(token) });
}

function TextButton({ label, token, onPress, disabled, testID }: { label: string; token: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  const text = useText();
  return (
    <Pressable
      role="button"
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [disabled && { opacity: 0.4 }, pressed && !disabled && { opacity: PRESS_OPACITY }]}
    >
      <Text style={[text(14, 21, token), styles.bold]}>{label}</Text>
    </Pressable>
  );
}

/**
 * One paired phone, Watch or agent: its scope, when it paired and was last seen, the route it paired
 * through (or the adult an agent acts as), its sessions, and what can be done to it.
 */
export function PairedPhoneRow({
  phone,
  onRevoke,
  onRepair,
  onRemove,
  disabled,
}: {
  phone: PairedPhone;
  /** No changes while the phone's view of the household is stale. */
  disabled?: boolean;
  onRevoke?: () => void;
  onRepair?: () => void;
  onRemove?: () => void;
}) {
  const ui = useUI();
  const text = useText();
  const lines = phoneLines(phone);
  return (
    <View style={[styles.phone, { borderTopWidth: 1, borderTopColor: ui.color("hairline") }]} testID="phone-row">
      <View style={[styles.phoneIcon, { backgroundColor: ui.color("field") }]}>
        <ui.Icon name={phone.client === "watch" ? "watch" : phone.client === "agent" ? "robot" : "device-mobile"} size={18} color={ui.color("ink")} />
      </View>
      <View style={styles.phoneWords}>
        <Text style={[text(14, 21, "ink"), styles.bold]}>
          {phone.displayName} <Text style={[text(14, 21, "muted"), styles.regular]}>· {lines.scope}</Text>
        </Text>
        <Text style={[text(14, 21, "muted"), styles.line]}>{lines.status}</Text>
        <Text style={[text(14, 21, "muted"), styles.line]}>
          {lines.via ? (
            <>
              via <Text style={{ fontFamily: MONO }}>{lines.via.url}</Text> · {lines.via.transport}
            </>
          ) : (
            lines.viaMissing
          )}
        </Text>
      </View>
      {lines.sessions.map((session) => (
        <Text key={session.id} style={[text(14, 21, "muted"), styles.session]}>
          {session.line}
        </Text>
      ))}
      {onRevoke ? <TextButton label={COPY.revoke} token="danger" onPress={onRevoke} disabled={disabled} testID={`phone-revoke-${phone.id}`} /> : null}
      {onRepair ? <TextButton label={COPY.repair} token="accent" onPress={onRepair} disabled={disabled} testID={`phone-repair-${phone.id}`} /> : null}
      {onRemove ? <TextButton label={COPY.remove} token="danger" onPress={onRemove} disabled={disabled} testID={`phone-remove-${phone.id}`} /> : null}
    </View>
  );
}

/**
 * The household's paired phones, Watches and agents, most recently seen first, with revoked ones folded
 * away. Each callback asks first where the platform does, then makes the change.
 */
export function PairedDevicesCard({
  phones,
  canPair,
  onRevoke,
  onRepair,
  onRemove,
  onRemoveAllRevoked,
  disabled,
  phonesOnly = false,
}: {
  phones: PairedPhone[];
  /** Only active phones and Watches, the devices remote access serves; active agents are listed elsewhere. */
  phonesOnly?: boolean;
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
  const split = splitPhones(phones);
  // Revoked agents stay in the revoked list, the one place they can be removed from.
  const active = phonesOnly ? split.active.filter((phone) => phone.client !== "agent") : split.active;
  const revoked = split.revoked;
  const rule = { borderTopWidth: 1, borderTopColor: ui.color("hairline") };
  return (
    <View style={[styles.card, { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") }]} testID="paired-devices">
      <View style={[styles.head, { borderBottomColor: ui.color("hairline-card") }]}>
        <Text style={[text(14, 21, "ink"), styles.bold]}>{phonesOnly ? COPY.pairedRemote : COPY.paired}</Text>
        <Text style={text(14, 21, "muted")}>{phonesOnly ? COPY.pairedRemoteSub : COPY.pairedSub}</Text>
      </View>
      {active.length === 0 ? (
        <Text style={[text(14, 21, "muted"), styles.empty]}>
          {phonesOnly ? (canPair ? COPY.noRemotePhones : COPY.remoteFirstPhones) : canPair ? COPY.noPhones : COPY.remoteFirst}
        </Text>
      ) : (
        (showAll ? active : active.slice(0, PHONES_SHOWN)).map((phone) => (
          <PairedPhoneRow key={phone.id} phone={phone} disabled={disabled} onRevoke={() => onRevoke(phone)} />
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
                  disabled={disabled}
                  onRepair={canPair && phone.client === "phone" ? () => onRepair(phone) : undefined}
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
  const status = REMOTE_STATUS[tunnel?.status ?? "off"];
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
  head: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: 10, paddingHorizontal: 18, paddingVertical: 15, borderBottomWidth: 1 },
  remoteHead: { alignItems: "center", gap: 12 },
  bold: { fontWeight: "600" },
  regular: { fontWeight: "400" },
  grow: { flex: 1, minWidth: 200 },
  line: { marginTop: 2 },
  empty: { paddingHorizontal: 18, paddingVertical: 16 },
  phone: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 12 },
  phoneIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  phoneWords: { flex: 1, minWidth: 200 },
  session: { width: "100%", paddingLeft: 44 },
  listButton: { paddingHorizontal: 18, paddingVertical: 10 },
  remoteBody: { gap: 12, paddingHorizontal: 18, paddingVertical: 12 },
});
