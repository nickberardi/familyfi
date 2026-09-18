/**
 * Flattens groups + rules into the one row shape the Rules table renders.
 *
 * The design has a single row template for every line in the table — Internet
 * parents, nested category/app filters, and network-scoped rules. They differ
 * only by indent, mark, tag, and whether they can be deleted. Keeping that as a
 * pure model means the table component has no per-kind branching left in it.
 */

import {
  parentFacingRuleLabel,
  glyphForAppName,
  CURATED_CATEGORY_SLOTS,
  type CuratedSlot,
  type Rule,
} from "./rules";
import { roleTag } from "./display";
import type { Group } from "./types";

export type RuleRowKind = "internet" | "filter" | "network";

export type RuleMarkSpec = {
  kind: "person" | "group" | "filter" | "network";
  label: string;
  /** Curated category slot, when this row is one — drives the CSS glyph. */
  slot?: CuratedSlot;
};

export type RuleRow = {
  /** React key, stable across reloads. */
  id: string;
  /** DOM id, used by deep links from other pages. */
  anchorId: string;
  kind: RuleRowKind;
  /** Nested rows are indented under their Internet parent. */
  nested: boolean;
  mark: RuleMarkSpec;
  name: string;
  /** Secondary text beside the name: "Internet · teen", "filter", "2 networks". */
  kindTag: string;
  enabled: boolean;
  mode: "always" | "scheduled";
  schedule: { days: number[]; start: string | null; end: string | null };
  canDelete: boolean;
  /** Set on Internet rows. */
  group?: Group;
  /** Set on filter and network rows. */
  rule?: Rule;
};

function curatedSlot(rule: Rule): CuratedSlot | undefined {
  if (rule.kind !== "category") return undefined;
  return CURATED_CATEGORY_SLOTS.find((s) => rule.targetIds.includes(s.categoryId))?.slot;
}

function internetRow(group: Group): RuleRow {
  const tag = roleTag(group);
  return {
    id: `group:${group.id}`,
    anchorId: `group-${group.id}`,
    kind: "internet",
    nested: false,
    mark: {
      kind: group.kind === "things" ? "group" : "person",
      label:
        group.kind === "things"
          ? (group.monogram ?? group.name.slice(0, 2)).slice(0, 4).toUpperCase()
          : group.name.slice(0, 1).toUpperCase(),
    },
    name: group.name,
    kindTag:
      group.kind === "things"
        ? `Internet · group · ${group.deviceCount}`
        : `Internet${tag ? ` · ${tag}` : ""}`,
    // Internet is "on" when a FamilyFi block is in force and not suspended.
    enabled: !group.suspension.active,
    mode: group.mode === "scheduled" || group.schedule.enabled ? "scheduled" : "always",
    schedule: group.schedule,
    canDelete: false,
    group,
  };
}

function filterRow(rule: Rule, labels: Map<string, string>): RuleRow {
  const label = parentFacingRuleLabel(rule, labels);
  const slot = curatedSlot(rule);
  return {
    id: `rule:${rule.id}`,
    anchorId: `rule-${rule.id}`,
    kind: "filter",
    nested: true,
    mark: { kind: "filter", label: slot ? "" : glyphForAppName(label), slot },
    name: label,
    kindTag: rule.kind === "category" ? "filter" : "app rule",
    enabled: rule.enabled,
    mode: rule.mode,
    schedule: rule.schedule,
    canDelete: true,
    rule,
  };
}

function networkRow(
  rule: Rule,
  labels: Map<string, string>,
  networkNames: Map<string, string>,
): RuleRow {
  const names = rule.networkIds.map((id) => networkNames.get(id) ?? id.slice(0, 8));
  return {
    id: `rule:${rule.id}`,
    anchorId: `net-rule-${rule.id}`,
    kind: "network",
    nested: false,
    mark: { kind: "network", label: "NET" },
    name: parentFacingRuleLabel(rule, labels),
    kindTag: names.length
      ? `${names.join(", ")} ${names.length > 1 ? "networks" : "network"}`
      : "network",
    enabled: rule.enabled,
    mode: rule.mode,
    schedule: rule.schedule,
    canDelete: true,
    rule,
  };
}

/**
 * Network rules first, then each non-protected group's Internet row with its own
 * filters nested directly beneath it.
 */
export function buildRuleRows({
  groups,
  rules,
  labels,
  networkNames,
}: {
  groups: Group[];
  rules: Rule[];
  labels: Map<string, string>;
  networkNames: Map<string, string>;
}): RuleRow[] {
  const rows: RuleRow[] = [];

  for (const rule of rules) {
    if (rule.scope === "network") rows.push(networkRow(rule, labels, networkNames));
  }

  for (const group of groups) {
    if (group.protected) continue;
    rows.push(internetRow(group));
    for (const rule of rules) {
      if (rule.scope !== "network" && rule.groupId === group.id) {
        rows.push(filterRow(rule, labels));
      }
    }
  }

  return rows;
}
