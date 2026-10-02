"use client";

import { FAMILY_ROLE_CHOICES } from "@/lib/settings-copy";
import type { Group } from "@/lib/types";

import { useUI } from "./UIContext";

type Role = (typeof FAMILY_ROLE_CHOICES)[number];

/** A family member's role in Household, as the platform's own segmented control. */
export function FamilyRolePicker({
  group,
  locked,
  onChange,
  disabled,
}: {
  group: Pick<Group, "id" | "name" | "familyRole">;
  /** A member with a personal login stays an adult. */
  locked: boolean;
  onChange: (role: Role) => void;
  disabled?: boolean;
}) {
  const ui = useUI();
  return (
    <ui.Segmented
      name={`${group.name} role`}
      value={group.familyRole ?? ""}
      segments={FAMILY_ROLE_CHOICES.map((role) => ({ value: role, label: role[0]!.toUpperCase() + role.slice(1), disabled: locked && role !== "adult" }))}
      onChange={(next) => next !== group.familyRole && onChange(next as Role)}
      disabled={disabled}
      fit
      testID={`role-${group.id}`}
    />
  );
}
