"use client";

import { Pressable, StyleSheet, Text, View } from "react-native";

import { initials } from "@/lib/display";
import { noMembersAttention, syncStatusCard } from "@/lib/sync-copy";
import type { Session, SyncStatus, UpdateCheck } from "@/lib/types";
import { updateAlert } from "@/lib/update-copy";

import { PRESS_OPACITY, tokenOf, useUI } from "./UIContext";

/**
 * The cards beside the web's navigation, which the app shows at the top of More: an update on
 * offer, whether the gateway is in sync (with Reconcile now when it is not), groups that need a
 * device, and who is signed in.
 */

function useText() {
  const ui = useUI();
  return (size: number, lineHeight: number, token: string) => ({ fontFamily: ui.font, fontSize: size, lineHeight, color: ui.color(token) });
}

function Card({ tone, label, children, testID }: { tone?: "paused"; label?: string; children: React.ReactNode; testID?: string }) {
  const ui = useUI();
  return (
    <View
      role={label ? "region" : undefined}
      aria-label={label}
      style={[
        styles.card,
        tone === "paused"
          ? { backgroundColor: ui.color("paused-fill"), borderColor: ui.color("paused-line") }
          : { backgroundColor: ui.color("card"), borderColor: ui.color("line") },
      ]}
      testID={testID}
    >
      {children}
    </View>
  );
}

function CardButton({ label, fill, ink, onPress, disabled, testID }: { label: string; fill: string; ink: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  const ui = useUI();
  const text = useText();
  return (
    <Pressable
      role="button"
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.button, { backgroundColor: ui.color(fill) }, disabled && { opacity: 0.5 }, pressed && !disabled && { opacity: PRESS_OPACITY }]}
    >
      <Text style={[text(14, 21, ink), styles.buttonLabel]}>{label}</Text>
    </Pressable>
  );
}

/** "Update available" when a newer release is published; nothing otherwise. */
export function UpdateAlertCard({ update }: { update: UpdateCheck | null }) {
  const ui = useUI();
  const text = useText();
  const alert = updateAlert(update);
  if (!alert) return null;
  return (
    <Card label={alert.title} testID="update-alert">
      <View style={styles.titleRow}>
        <View style={[styles.dot, { backgroundColor: ui.color("accent") }]} />
        <Text style={[text(14, 21, "ink"), styles.bold]}>{alert.title}</Text>
      </View>
      <Text style={[text(14, 20, "muted"), styles.body]}>{alert.body}</Text>
      <ui.Link href={alert.href} testID="update-alert-link">
        <View style={[styles.button, { backgroundColor: ui.color("accent") }]}>
          <Text style={[text(14, 21, "ink-on-fill"), styles.buttonLabel]}>{alert.action}</Text>
        </View>
      </ui.Link>
    </Card>
  );
}

/** Whether the gateway is in sync, why not, and Reconcile now when it is not. */
export function SyncStatusCard({
  sync,
  busy,
  error,
  notice,
  onReconcile,
  disabled,
}: {
  sync: SyncStatus | null;
  busy: boolean;
  error?: string | null;
  notice?: string | null;
  onReconcile: () => void;
  /** No reconcile while the household is stale. */
  disabled?: boolean;
}) {
  const ui = useUI();
  const text = useText();
  const status = syncStatusCard(sync, { busy, error, notice });
  return (
    <Card testID="sync-status">
      <View style={styles.titleRow}>
        <View style={[styles.dot, { backgroundColor: ui.color(tokenOf(status.dot)) }]} />
        <Text style={[text(14, 21, "ink"), styles.bold]}>{status.title}</Text>
      </View>
      <Text style={[text(14, 20, "muted"), styles.body]}>{status.message}</Text>
      {status.showReconcile ? (
        <CardButton label={status.reconcile} fill="accent-fill" ink="accent" onPress={onReconcile} disabled={busy || disabled} testID="sync-reconcile" />
      ) : null}
    </Card>
  );
}

/** Groups whose rules wait for a device, with the way to assign one. Nothing when none wait. */
export function DeviceAttentionCard({ sync }: { sync: SyncStatus | null }) {
  const ui = useUI();
  const text = useText();
  const attention = noMembersAttention(sync?.issues ?? []);
  if (!attention) return null;
  return (
    <Card tone="paused" testID="device-attention">
      <Text style={[text(14, 21, "paused"), styles.bold]}>{attention.title}</Text>
      <Text style={[text(14, 20, "muted"), styles.body]}>{attention.message}</Text>
      <ui.Link href={attention.href} testID="device-attention-link">
        <View style={[styles.button, { backgroundColor: ui.color("paused-fill-strong") }]}>
          <Text style={[text(14, 21, "paused"), styles.buttonLabel]}>Assign devices</Text>
        </View>
      </ui.Link>
    </Card>
  );
}

/** Who is signed in, and Sign out. */
export function AccountCard({ session, onSignOut, label = "Sign out" }: { session: Pick<Session, "displayName" | "username"> | null; onSignOut: () => void; label?: string }) {
  const ui = useUI();
  const text = useText();
  return (
    <View style={[styles.account, { backgroundColor: ui.color("card-veil") }]} testID="account-card">
      <View style={[styles.avatar, { backgroundColor: ui.color("person-fill") }]}>
        <Text style={[text(14, 21, "on"), styles.bold]}>{initials(session?.displayName ?? "A")}</Text>
      </View>
      <View style={styles.who}>
        <Text style={[text(14, 21, "ink"), styles.bold]} numberOfLines={1}>
          {session?.displayName ?? "…"}
        </Text>
        <Text style={text(14, 21, "muted")} numberOfLines={1}>
          {session?.username}
        </Text>
      </View>
      <Pressable
        role="button"
        onPress={onSignOut}
        testID="account-sign-out"
        style={({ pressed }) => [styles.signOut, { borderColor: ui.color("line") }, pressed && { opacity: PRESS_OPACITY }]}
      >
        <Text style={[text(14, 21, "accent"), styles.bold]}>{label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 9, borderWidth: 1, padding: 10 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  bold: { fontWeight: "600" },
  body: { marginTop: 4 },
  button: { marginTop: 8, borderRadius: 6, paddingVertical: 6, alignItems: "center" },
  buttonLabel: { fontWeight: "600", textAlign: "center" },
  account: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 10, padding: 10 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  who: { flex: 1, minWidth: 0 },
  signOut: { flexShrink: 0, borderRadius: 7, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
});
