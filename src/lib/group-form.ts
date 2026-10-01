/**
 * Adding, editing and deleting a group, as every client asks for it: what the new-group sheet and
 * the group detail say, when a draft may be sent, and what it sends (`POST /groups`, `PUT
 * /groups/{id}`). The writes themselves are in `group-writes.ts`.
 */
import type { Account, Group } from "./types";

export type FamilyRole = "child" | "teen" | "adult";
export type GroupKind = Group["kind"];

export const FAMILY_ROLES: readonly { value: FamilyRole; label: string }[] = [
  { value: "child", label: "Child" },
  { value: "teen", label: "Teen" },
  { value: "adult", label: "Adult" },
];

/** A monogram is up to four capitals, e.g. TV or PC. */
export const MONOGRAM_MAX = 4;
export function normalizeMonogram(value: string): string {
  return value.toUpperCase().slice(0, MONOGRAM_MAX);
}

/** The new-group sheet's words, for a family member or a Things group. */
export function newGroupCopy(kind: GroupKind) {
  const family = kind === "family";
  return {
    title: family ? "New family member" : "New group",
    body: family
      ? "A person in the household. Assign their devices afterward."
      : "A Things group is any set of devices that isn't a person. Assign devices to it afterward.",
    namePlaceholder: family ? "e.g. Sam" : "e.g. Consoles",
    monogramLabel: "Monogram — up to 4 characters, e.g. TV, PC",
    create: family ? "Add person" : "Create group",
    cancel: "Cancel",
    failed: `Could not add ${family ? "the person" : "the group"}.`,
  } as const;
}

/** The notice after adding a group. */
export function groupAddedNotice(name: string): string {
  return `${name} added. Assign devices on the Devices page.`;
}

export type NewGroupDraft = { kind: GroupKind; name: string; familyRole: FamilyRole; monogram: string };

/** The body `POST /groups` takes for a draft, or null while it has no name. */
export function newGroupBody(draft: NewGroupDraft) {
  const name = draft.name.trim();
  if (!name) return null;
  const monogram = draft.monogram.trim();
  return {
    kind: draft.kind,
    name,
    familyRole: draft.kind === "family" ? draft.familyRole : undefined,
    monogram: draft.kind === "things" && monogram ? monogram : undefined,
  };
}

/** The monogram a new Things group would get with none typed: its name's first two letters. */
export function monogramPlaceholder(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || "e.g. TV";
}

export type GroupEditDraft = { name: string; familyRole: FamilyRole; monogram: string };

export function groupEditDraft(group: Group): GroupEditDraft {
  return { name: group.name, familyRole: group.familyRole ?? "child", monogram: group.monogram ?? "" };
}

/**
 * A family member with their own login stays an adult: logins belong to adults, so while one
 * is linked to this group its role cannot change.
 */
export function roleLocked(group: Pick<Group, "id">, accounts: readonly Pick<Account, "recovery" | "groupId">[]): boolean {
  return accounts.some((account) => !account.recovery && account.groupId === group.id);
}

/** The body `PUT /groups/{id}` takes for an edit, or null when there is nothing (valid) to save. */
export function groupEditBody(group: Group, draft: GroupEditDraft) {
  const name = draft.name.trim();
  if (!name) return null;
  if (group.kind === "family") {
    if (name === group.name && draft.familyRole === group.familyRole) return null;
    return { name, familyRole: draft.familyRole };
  }
  const monogram = draft.monogram.trim() || null;
  if (name === group.name && monogram === (group.monogram ?? null)) return null;
  return { name, monogram };
}

/** Whether a group with no devices is told its rules cannot apply until it has one. */
export function rulesNeedDevice(group: Pick<Group, "internetRuleIds" | "suspension">): boolean {
  return group.internetRuleIds.length > 0 || group.suspension.active;
}

/** The group detail's words. */
export const GROUP_DETAIL_COPY = {
  edit: "Edit",
  name: "Name",
  role: "Role",
  monogram: "Monogram",
  save: "Save",
  saving: "Saving…",
  neverMind: "Never mind",
  roleLocked: "This person has a personal login, so their role stays Adult.",
  currentState: "Current state",
  devices: "Devices",
  noDevices: "No devices assigned.",
  /** After "No devices assigned." when the group has rules or a pause: the words around the link to assign one. */
  rulesNeedDevice: { before: "Its rules cannot apply on UniFi until you", link: "assign a device", after: "." },
  manageDevices: "Manage devices",
  delete: "Delete group",
  notFound: "Group not found.",
} as const;

/** What deleting a group does, before the person confirms it. */
export function deleteGroupConfirm(group: Pick<Group, "name">) {
  return {
    title: `Delete ${group.name}?`,
    body: "Its devices become Unassigned and quarantined until you assign them. Any linked personal login remains active but is no longer linked to this group.",
    confirm: "Delete group",
    cancel: "Never mind",
  } as const;
}
