"use client";

import { FAMILY_ROLE_CHOICES } from "@/lib/settings-copy";
import type { Group } from "@/lib/types";

type Role = (typeof FAMILY_ROLE_CHOICES)[number];

/** The web's role radios in Household: a white knob on the field trough. */
export function FamilyRolePicker({
  group,
  locked,
  onChange,
}: {
  group: Pick<Group, "id" | "name" | "familyRole">;
  locked: boolean;
  onChange: (role: Role) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-none gap-0.5 rounded-lg bg-[var(--ff-field)] p-0.5" role="radiogroup" aria-label={`${group.name} role`}>
      {FAMILY_ROLE_CHOICES.map((role) => {
        const on = group.familyRole === role;
        const disabled = locked && role !== "adult";
        return (
          <button
            key={role}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            className="rounded-md px-2.5 py-1 text-[14px] capitalize disabled:opacity-40"
            style={{
              fontWeight: on ? 600 : 500,
              background: on ? "var(--ff-ink-on-fill)" : "transparent",
              color: on ? "var(--ff-ink)" : "var(--ff-muted)",
              boxShadow: on ? "var(--ff-shadow-knob)" : "none",
            }}
            onClick={() => {
              if (on || disabled) return;
              onChange(role);
            }}
          >
            {role}
          </button>
        );
      })}
    </div>
  );
}
