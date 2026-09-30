"use client";

import { useState } from "react";
import { FAMILY_ROLES, MONOGRAM_MAX, monogramPlaceholder, newGroupCopy, normalizeMonogram, type FamilyRole } from "@/lib/group-form";
import { createGroup } from "@/lib/group-writes";
import { useAppData } from "@/components/AppDataProvider";
import { Field, TextField } from "@/components/ui/Controls";
import { Segmented } from "@/components/ui/Segmented";

/**
 * Adds a family member or a Things group over the page it was opened from, like adding a
 * category. Devices are assigned afterwards, so a name (and a role, or a monogram) is all
 * it asks for; the new card appears in place.
 */
export function NewGroupSheet({ kind, onClose }: { kind: "family" | "things"; onClose: () => void }) {
  const { store } = useAppData();
  const [name, setName] = useState("");
  const [familyRole, setFamilyRole] = useState<FamilyRole>("child");
  const [monogram, setMonogram] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const trimmed = name.trim();
  const canCreate = !busy && trimmed.length > 0;
  const family = kind === "family";
  const copy = newGroupCopy(kind);

  async function create() {
    if (!canCreate) return;
    setBusy(true);
    setError("");
    const result = await createGroup(store.mutate, { kind, name, familyRole, monogram });
    setBusy(false);
    // A failure is reported by `mutate`; the sheet stays open so nothing typed is lost.
    if (result?.group) onClose();
    else setError(copy.failed);
  }

  return (
    <div
      className="fixed inset-0 z-[81] flex items-center justify-center p-6"
      style={{ background: "var(--ff-scrim)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-group-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] overflow-hidden rounded-[14px]"
        style={{ background: "var(--ff-card)", boxShadow: "var(--ff-shadow-sheet)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="px-5 pb-1 pt-[18px]">
          <h2 id="new-group-title" className="m-0 text-[17px] font-bold tracking-tight">
            {copy.title}
          </h2>
          <p className="mt-1 text-[13px] leading-snug" style={{ color: "var(--ff-ink-3)" }}>
            {copy.body}
          </p>
        </header>
        <div className="flex flex-col gap-3.5 px-5 py-4">
          <Field label="Name">
            <TextField label="Name" value={name} onChange={setName} placeholder={copy.namePlaceholder} onSubmit={create} />
          </Field>
          {family ? (
            <Field label="Role">
              <Segmented
                name="Role"
                grow
                value={familyRole}
                onChange={setFamilyRole}
                segments={[...FAMILY_ROLES]}
              />
            </Field>
          ) : (
            <Field label={copy.monogramLabel}>
              <TextField
                label="Monogram"
                value={monogram}
                onChange={(value) => setMonogram(normalizeMonogram(value))}
                placeholder={monogramPlaceholder(trimmed)}
                maxLength={MONOGRAM_MAX}
                onSubmit={create}
              />
            </Field>
          )}
          {error ? (
            <p className="m-0 text-[13px]" style={{ color: "var(--ff-danger)" }}>
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex" style={{ borderTop: "1px solid var(--ff-hairline-card)" }}>
          <button type="button" onClick={onClose} className="flex-1 px-5 py-[13px] text-[14px]" style={{ color: "var(--ff-ink-3)" }}>
            {copy.cancel}
          </button>
          <button
            type="button"
            onClick={() => void create()}
            disabled={!canCreate}
            className="flex-1 px-5 py-[13px] text-[14px] font-semibold"
            style={{
              borderLeft: "1px solid var(--ff-hairline-card)",
              color: canCreate ? "var(--ff-accent)" : "var(--ff-locked)",
            }}
          >
            {copy.create}
          </button>
        </div>
      </div>
    </div>
  );
}
