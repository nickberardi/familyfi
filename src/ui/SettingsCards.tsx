"use client";

import { useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { initials } from "@/lib/display";
import type { HouseholdStore } from "@/lib/household-store";
import { SETTINGS_COPY as COPY, gatewayFacts, householdMemberNote, keyState, keyStatusLine, recoveryNote, removeAdminConfirm, removeLoginConfirm } from "@/lib/settings-copy";
import { addFamilyMember, removeLogin, saveTimezone, setAdmin, setFamilyRole } from "@/lib/settings-writes";
import { lastSweepAt, relativeSweep } from "@/lib/sync-copy";
import type { Account, Group, SyncStatus, UnifiSettings } from "@/lib/types";

import { AddMemberField } from "./AddMemberField";
import { AdminControl } from "./AdminControl";
import { FamilyRolePicker } from "./FamilyRolePicker";
import { TimezoneField } from "./TimezoneField";
import { PRESS_OPACITY, tokenOf, useUI } from "./UIContext";

const MONO = Platform.select({ web: "var(--font-mono)", ios: "Menlo", default: "monospace" });

type Mutate = HouseholdStore["mutate"];

function useText() {
  const ui = useUI();
  return (size: number, lineHeight: number, token: string) => ({ fontFamily: ui.font, fontSize: size, lineHeight, color: ui.color(token) });
}

function Card({ title, sub, children, testID }: { title: string; sub?: string; children: ReactNode; testID?: string }) {
  const ui = useUI();
  const text = useText();
  return (
    <View style={[styles.card, { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") }]} testID={testID}>
      <View style={[styles.cardHead, { borderBottomColor: ui.color("hairline-card") }]}>
        <Text style={[text(14, 21, "ink"), styles.bold]}>{title}</Text>
        {sub ? <Text style={text(14, 21, "muted")}>{sub}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function FilledButton({ label, onPress, disabled, testID }: { label: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  const ui = useUI();
  const text = useText();
  return (
    <Pressable
      role="button"
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.filled, { backgroundColor: ui.color("accent") }, disabled && { opacity: 0.4 }, pressed && !disabled && { opacity: PRESS_OPACITY }]}
    >
      <Text style={[text(14, 21, "ink-on-fill"), styles.bold]}>{label}</Text>
    </Pressable>
  );
}

/**
 * The gateway's facts and the household's time zone. `children` follows them: the web's connection
 * editor, or a client's note that the connection is changed on the web.
 */
export function GatewayCard({
  unifi,
  timezone,
  mutate,
  disabled,
  children,
}: {
  unifi: UnifiSettings | null;
  timezone: string;
  mutate: Mutate;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const ui = useUI();
  const text = useText();
  const [draft, setDraft] = useState(timezone);
  const [shown, setShown] = useState(timezone);
  // A saved or reloaded zone replaces the draft, as the web's page adopts the household's.
  if (timezone !== shown) {
    setShown(timezone);
    setDraft(timezone);
  }
  return (
    <Card title={COPY.gateway} testID="settings-gateway">
      {gatewayFacts(unifi).map((fact, index) => (
        <View key={fact.k} style={[styles.fact, index > 0 && { borderTopWidth: 1, borderTopColor: ui.color("hairline") }]}>
          <Text style={[text(14, 21, "muted"), styles.factKey]}>{fact.k}</Text>
          <Text style={[text(14, 21, "ink"), styles.factValue]}>{fact.v}</Text>
        </View>
      ))}
      <View style={[styles.row, styles.timezone, { borderTopColor: ui.color("hairline") }]}>
        <View style={styles.timezoneField}>
          <TimezoneField value={draft} onChange={setDraft} disabled={disabled} />
        </View>
        <FilledButton label={COPY.saveTimezone} onPress={() => void saveTimezone(mutate, draft)} disabled={disabled} testID="settings-save-timezone" />
      </View>
      {children}
    </Card>
  );
}

/** The masked UniFi key, whether it works, and what FamilyFi can and cannot do with it. `children` is the web's key editor. */
export function KeyCard({
  unifi,
  sync,
  issuer = COPY.keyIssuer,
  stored = COPY.keyStored,
  children,
}: {
  unifi: UnifiSettings | null;
  sync: SyncStatus | null;
  /** Who can replace the key, as this client says it. */
  issuer?: string;
  stored?: string;
  children?: ReactNode;
}) {
  const ui = useUI();
  const text = useText();
  const state = keyState(unifi);
  return (
    <Card title={COPY.key} testID="settings-key">
      <View style={styles.keyBody}>
        <View style={styles.keyRow}>
          <Text style={[text(14, 21, "ink"), { fontFamily: MONO }]} testID="settings-key-masked">
            {unifi?.apiKeyMasked ?? COPY.noKey}
          </Text>
          <Text style={[text(14, 21, tokenOf(state.ink)), styles.bold, styles.chip, { backgroundColor: ui.color(tokenOf(state.bg)) }]}>{state.label}</Text>
        </View>
        <Text style={[text(14, 20, "muted"), styles.keyLine]}>{keyStatusLine(unifi, lastSweepAt(sync), (iso) => relativeSweep(iso))}</Text>
        <Text style={[text(14, 20, "muted"), styles.note, { backgroundColor: ui.color("note-fill") }]}>{issuer}</Text>
        {children}
        <Text style={[text(14, 20, "muted"), styles.stored]}>{stored}</Text>
      </View>
    </Card>
  );
}

/**
 * Who is in the household: the recovery admin, each family member with their role, admin and login,
 * and a row to add one. `onCreateLogin` opens the platform's new-login form for an adult without one.
 */
export function HouseholdCard({
  groups,
  accounts,
  mutate,
  disabled,
  onCreateLogin,
}: {
  groups: Group[];
  accounts: Account[];
  mutate: Mutate;
  disabled?: boolean;
  onCreateLogin: (group: Group) => void;
}) {
  const ui = useUI();
  const text = useText();
  const [name, setName] = useState("");
  const family = groups.filter((group) => group.kind === "family");
  const personal = accounts.filter((account) => !account.recovery);
  const recovery = accounts.find((account) => account.recovery);
  const add = () => {
    const trimmed = name.trim();
    if (!trimmed || disabled) return;
    void addFamilyMember(mutate, trimmed).then((result) => result && setName(""));
  };

  const avatar = (letters: string) => (
    <View style={[styles.avatar, { backgroundColor: ui.color("mark") }]}>
      <Text style={[text(14, 21, "ink-on-fill"), styles.bold]}>{letters}</Text>
    </View>
  );

  return (
    <Card title={COPY.household} sub={COPY.householdSub} testID="settings-household">
      {recovery ? (
        <View style={[styles.row, styles.member]}>
          {avatar(initials(recovery.displayName))}
          <View style={styles.grow}>
            <Text style={[text(14, 21, "ink"), styles.bold]}>{recovery.displayName}</Text>
            <Text style={[text(14, 21, "muted"), styles.memberNote]}>{recoveryNote(recovery)}</Text>
          </View>
        </View>
      ) : null}
      {family.map((group) => {
        const account = personal.find((item) => item.groupId === group.id);
        return (
          <View key={group.id} style={[styles.row, styles.member, styles.wrap, { borderTopWidth: 1, borderTopColor: ui.color("hairline") }]} testID={`settings-member-${group.id}`}>
            {avatar(group.monogram || initials(group.name))}
            <View style={[styles.grow, styles.memberWords]}>
              <Text style={[text(14, 21, "ink"), styles.bold]}>{group.name}</Text>
              <Text style={[text(14, 21, "muted"), styles.memberNote]}>{householdMemberNote(group, account)}</Text>
            </View>
            <FamilyRolePicker group={group} locked={Boolean(account)} onChange={(role) => void setFamilyRole(mutate, group, role)} disabled={disabled} />
            {group.familyRole === "adult" ? (
              <AdminControl
                name={group.name}
                on={Boolean(account?.isAdmin)}
                disabled={disabled}
                testID={`settings-admin-${group.id}`}
                onPress={async () => {
                  if (!account) return onCreateLogin(group);
                  // Turning it off signs them out and removes their paired devices, so it asks first.
                  if (account.isAdmin && !(await ui.confirm({ ...removeAdminConfirm(account, group), destructive: true }))) return;
                  void setAdmin(mutate, account, !account.isAdmin);
                }}
              />
            ) : null}
            {account ? (
              <Pressable
                role="button"
                disabled={disabled}
                onPress={async () => {
                  const go = await ui.confirm({ ...removeLoginConfirm(account, group), destructive: true });
                  if (go) void removeLogin(mutate, account);
                }}
                testID={`settings-remove-login-${group.id}`}
                style={({ pressed }) => [disabled && { opacity: 0.4 }, pressed && { opacity: PRESS_OPACITY }]}
              >
                <Text style={[text(14, 21, "danger"), styles.bold]}>{COPY.removeLogin}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
      <View style={[styles.row, styles.addRow, { borderTopColor: ui.color("hairline") }]}>
        <View style={styles.grow}>
          <AddMemberField value={name} onChange={setName} onSubmit={add} disabled={disabled} />
        </View>
        <FilledButton label={COPY.add} onPress={add} disabled={disabled || !name.trim()} testID="settings-add-member-button" />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  cardHead: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: 10, paddingHorizontal: 18, paddingVertical: 15, borderBottomWidth: 1 },
  bold: { fontWeight: "600" },
  grow: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18 },
  wrap: { flexWrap: "wrap" },
  fact: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 10 },
  factKey: { width: 130, flexShrink: 0 },
  factValue: { flex: 1, minWidth: 0, textAlign: "right", fontFamily: MONO },
  timezone: { flexWrap: "wrap", alignItems: "flex-end", paddingVertical: 12, borderTopWidth: 1 },
  timezoneField: { flexGrow: 1, flexBasis: 220, minWidth: 0 },
  filled: { flexShrink: 0, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  keyBody: { paddingHorizontal: 18, paddingVertical: 16 },
  keyRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: 10 },
  chip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  keyLine: { marginTop: 6 },
  note: { marginTop: 12, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, overflow: "hidden" },
  stored: { marginTop: 10 },
  member: { paddingVertical: 12 },
  memberWords: { minWidth: 150 },
  memberNote: { marginTop: 2 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  addRow: { gap: 10, paddingVertical: 12, borderTopWidth: 1 },
});
