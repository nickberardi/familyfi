"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { Group } from "@/lib/types";
import { useAppData } from "@/components/AppDataProvider";
import { Field, TextField } from "@/components/ui/Controls";
import { Segmented } from "@/components/ui/Segmented";

type Role = "child" | "teen" | "adult";

/**
 * Adds a family member or a Things group over the page it was opened from, like adding a
 * category. Devices are assigned afterwards, so a name (and a role, or a monogram) is all
 * it asks for; the new card appears in place.
 */
export function NewGroupSheet({ kind, onClose }: { kind: "family" | "things"; onClose: () => void }) {
  const { mutate } = useAppData();
  const [name, setName] = useState("");
  const [familyRole, setFamilyRole] = useState<Role>("child");
  const [monogram, setMonogram] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const trimmed = name.trim();
  const canCreate = !busy && trimmed.length > 0;
  const family = kind === "family";

  async function create() {
    if (!canCreate) return;
    setBusy(true);
    setError("");
    const result = await mutate(
      () =>
        api<{ group: Group; change: { changeId: string } }>("/api/v1/groups", {
          method: "POST",
          body: JSON.stringify({
            kind,
            name: trimmed,
            familyRole: family ? familyRole : undefined,
            monogram: !family && monogram.trim() ? monogram.trim() : undefined,
          }),
        }),
      undefined,
      { notice: `${trimmed} added. Assign devices on the Devices page.` },
    );
    setBusy(false);
    // A failure is reported by `mutate`; the sheet stays open so nothing typed is lost.
    if (result?.group) onClose();
    else setError(`Could not add ${family ? "the person" : "the group"}.`);
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
            {family ? "New family member" : "New group"}
          </h2>
          <p className="mt-1 text-[13px] leading-snug" style={{ color: "var(--ff-ink-3)" }}>
            {family
              ? "A person in the household. Assign their devices afterward."
              : "A Things group is any set of devices that isn't a person. Assign devices to it afterward."}
          </p>
        </header>
        <div className="flex flex-col gap-3.5 px-5 py-4">
          <Field label="Name">
            <TextField label="Name" value={name} onChange={setName} placeholder={family ? "e.g. Sam" : "e.g. Consoles"} onSubmit={create} />
          </Field>
          {family ? (
            <Field label="Role">
              <Segmented
                name="Role"
                grow
                value={familyRole}
                onChange={setFamilyRole}
                segments={[
                  { value: "child", label: "Child" },
                  { value: "teen", label: "Teen" },
                  { value: "adult", label: "Adult" },
                ]}
              />
            </Field>
          ) : (
            <Field label="Monogram — up to 3 characters, e.g. TV, PC">
              <TextField
                label="Monogram"
                value={monogram}
                onChange={(value) => setMonogram(value.toUpperCase())}
                placeholder={trimmed.slice(0, 2).toUpperCase() || "e.g. TV"}
                maxLength={3}
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
            Cancel
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
            {family ? "Add person" : "Create group"}
          </button>
        </div>
      </div>
    </div>
  );
}
