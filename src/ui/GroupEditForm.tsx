"use client";

import { StyleSheet, Text, View } from "react-native";

import { FAMILY_ROLES, GROUP_DETAIL_COPY, GROUP_EDIT_COPY as COPY, MONOGRAM_MAX, type FamilyRole, type GroupDohMode } from "@/lib/group-form";
import { GROUP_RESOLVER_COPY, groupResolverNetworkLine, groupResolverSummary } from "@/lib/group-resolver";

import { Alert } from "./Alert";
import { BlockButtonField, EditField } from "./GroupEditFields";
import { useUI } from "./UIContext";
import type { GroupEdit } from "./use-group-edit";

/**
 * A group's Edit sheet inside each client's own frame, as the design's "Edit <name>" modal has it:
 * its name, a person's role or a Things group's monogram, what its card's Block button stands for
 * (shown when it has a category, app or website rule), where its category checks reach DNS, and
 * why the last save was refused. Save, Cancel and Delete belong to the frame: the web's dialog
 * footer, the app's navigation bar.
 */
export function GroupEditForm({
  edit,
  enabled = true,
  onSubmit,
}: {
  edit: GroupEdit;
  /** False while the household is stale, so nothing can be changed. */
  enabled?: boolean;
  /** Return in the name field saves, where the frame has no form of its own to submit. */
  onSubmit?: () => void;
}) {
  const ui = useUI();
  const { group, draft, set, error, resolver, demo } = edit;
  const custom = draft.doh === "custom";
  const name = draft.name.trim() || group.name;
  const note = [styles.note, { fontFamily: ui.font, color: ui.color("ink-2") }];
  return (
    <View style={styles.form} testID="group-edit-form">
      <EditField label={GROUP_DETAIL_COPY.name}>
        <ui.TextField label={GROUP_DETAIL_COPY.name} value={draft.name} onChange={(next) => set({ name: next })} onSubmit={onSubmit} disabled={!enabled} testID="group-name" />
      </EditField>
      {group.kind === "family" ? (
        <EditField label={GROUP_DETAIL_COPY.role} group note={edit.roleLocked ? GROUP_DETAIL_COPY.roleLocked : undefined}>
          <ui.Segmented
            name={GROUP_DETAIL_COPY.role}
            value={draft.familyRole}
            // A linked login keeps the role Adult, and a role stored otherwise can still move to it.
            segments={FAMILY_ROLES.map((role) => ({ ...role, disabled: edit.roleLocked && role.value !== "adult" }))}
            onChange={(familyRole) => set({ familyRole: familyRole as FamilyRole })}
            disabled={!enabled}
            testID="group-role"
          />
        </EditField>
      ) : (
        <EditField label={GROUP_DETAIL_COPY.monogram}>
          <ui.TextField
            label={GROUP_DETAIL_COPY.monogram}
            value={draft.monogram}
            onChange={(monogram) => set({ monogram })}
            maxLength={MONOGRAM_MAX}
            capitals
            disabled={!enabled}
            testID="group-monogram"
          />
        </EditField>
      )}
      {edit.blockButtonChoices.length > 1 ? (
        <BlockButtonField
          label={COPY.blockButton}
          help={COPY.blockButtonHelp(name)}
          choices={edit.blockButtonChoices}
          value={edit.blockButtonChoices.some((choice) => choice.value === draft.blockButtonRuleId) ? (draft.blockButtonRuleId ?? "") : ""}
          onChange={(blockButtonRuleId) => set({ blockButtonRuleId })}
          disabled={!enabled}
        />
      ) : null}
      <EditField label={COPY.doh} group>
        <ui.Segmented name={COPY.doh} value={draft.doh} segments={COPY.dohModes} onChange={(doh) => set({ doh: doh as GroupDohMode })} disabled={!enabled || demo} testID="group-doh" />
      </EditField>
      {custom ? (
        <EditField label={COPY.url}>
          <ui.TextField label={COPY.url} value={draft.url} onChange={(url) => set({ url })} placeholder={COPY.urlPlaceholder} url mono disabled={!enabled || demo} testID="group-edit-url" />
        </EditField>
      ) : null}
      <View style={styles.help} testID="group-edit-dns-help">
        {demo ? (
          <Text style={note}>{COPY.demoLocked}</Text>
        ) : custom ? (
          <Text style={note}>{GROUP_RESOLVER_COPY.overrideNote(name)}</Text>
        ) : resolver !== undefined ? (
          <>
            <Text style={note}>{groupResolverSummary(resolver)}</Text>
            {resolver?.networks.map((network) => (
              <Text key={network.id} style={note}>
                {groupResolverNetworkLine(network)}
              </Text>
            ))}
          </>
        ) : null}
        <Text style={note}>{GROUP_RESOLVER_COPY.hostNote}</Text>
      </View>
      {error ? (
        <Alert tone="danger" role="alert" action={error.link ? { label: error.link.label, href: error.link.url, testID: "group-edit-error-link" } : undefined} testID="group-edit-error">
          {error.text}
        </Alert>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 14 },
  help: { gap: 4 },
  note: { fontSize: 14, lineHeight: 20 },
});
