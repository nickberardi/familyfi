"use client";

import type { ReactNode } from "react";

import { RULE_EDITOR_COPY as COPY, toggleRuleGroup, toggleRuleNetwork, type AppliesTo } from "@/lib/rule-editor";
import type { Group } from "@/lib/types";

import { Chip, ChipGroup } from "./Chips";
import { EditorSection } from "./EditorSection";
import { useUI } from "./UIContext";

/**
 * A rule's "Applies to" section, shared by every rule's form: people and things, or whole managed
 * networks when FamilyFi manages any, each picked as chips. `locked` turns off a scope the rule
 * cannot take; `children` are notes under the scope picker.
 */
export function RuleAppliesTo<T extends AppliesTo>({
  draft,
  groups,
  networks,
  edit,
  note = COPY.appliesTo.note,
  locked = {},
  disabled = false,
  testID,
  children,
}: {
  draft: T;
  groups: Pick<Group, "id" | "name">[];
  /** The networks FamilyFi manages (`managedNetworks`), which a rule can cover whole. */
  networks: { id: string; name: string }[];
  edit: (next: (draft: T) => T) => void;
  note?: string;
  locked?: { group?: boolean; network?: boolean };
  disabled?: boolean;
  /** Prefixes the picker's test ids: `<testID>-scope`, `<testID>-group-<id>`, `<testID>-network-<id>`. */
  testID: string;
  children?: ReactNode;
}) {
  const ui = useUI();
  return (
    <EditorSection title={COPY.appliesTo.title} note={note}>
      {networks.length ? (
        <ui.Segmented
          name={COPY.appliesTo.title}
          value={draft.scope}
          segments={[
            { value: "group", label: COPY.appliesTo.groups, disabled: Boolean(locked.group) },
            { value: "network", label: COPY.appliesTo.networks, disabled: Boolean(locked.network) },
          ]}
          onChange={(scope) => edit((current) => ({ ...current, scope: scope as AppliesTo["scope"] }))}
          disabled={disabled}
          fit
          testID={`${testID}-scope`}
        />
      ) : null}
      {children}
      {draft.scope === "group" ? (
        <ChipGroup label={COPY.appliesTo.groupsLabel}>
          {groups.map((group) => (
            <Chip
              key={group.id}
              on={draft.groupIds.includes(group.id)}
              onPress={() => edit((current) => toggleRuleGroup(current, group.id))}
              disabled={disabled}
              testID={`${testID}-group-${group.id}`}
            >
              {group.name}
            </Chip>
          ))}
        </ChipGroup>
      ) : (
        <ChipGroup label={COPY.appliesTo.networksLabel}>
          {networks.map((network) => (
            <Chip
              key={network.id}
              on={draft.networkIds.includes(network.id)}
              onPress={() => edit((current) => toggleRuleNetwork(current, network.id))}
              disabled={disabled}
              testID={`${testID}-network-${network.id}`}
            >
              {network.name}
            </Chip>
          ))}
        </ChipGroup>
      )}
    </EditorSection>
  );
}
