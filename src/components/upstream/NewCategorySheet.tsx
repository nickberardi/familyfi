"use client";

import { useState } from "react";
import { request } from "@/lib/api";
import { CATEGORIES_COPY, createCategory } from "@/lib/upstream-writes";
import { suggestedMonogramFor } from "@/lib/upstream";
import { Field, TextField } from "@/components/ui/Controls";

/**
 * A custom category is report-only by construction — there is no DPI id to give it,
 * so nothing here offers one. The monogram is typed rather than derived from an icon
 * set, because a household can invent a category we have no artwork for.
 */
export function NewCategorySheet({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const copy = CATEGORIES_COPY.create;
  const [label, setLabel] = useState("");
  const [monogram, setMonogram] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const trimmed = label.trim();
  const canCreate = !busy && trimmed.length > 0;

  async function create() {
    if (!canCreate) return;
    setBusy(true);
    setError("");
    try {
      await createCategory(request, trimmed, monogram);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[81] flex items-center justify-center p-6"
      style={{ background: "var(--ff-scrim)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-category-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] overflow-hidden rounded-[14px]"
        style={{ background: "var(--ff-card)", boxShadow: "var(--ff-shadow-sheet)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="px-5 pb-1 pt-[18px]">
          <h2 id="new-category-title" className="m-0 text-[17px] font-bold tracking-tight">
            {copy.title}
          </h2>
          <p className="mt-1 text-[13px] leading-snug" style={{ color: "var(--ff-ink-3)" }}>
            {copy.body}
          </p>
        </header>
        <div className="flex flex-col gap-3.5 px-5 py-4">
          <Field label={copy.name}>
            <TextField
              label={copy.nameLabel}
              value={label}
              onChange={setLabel}
              placeholder={copy.namePlaceholder}
              onSubmit={create}
            />
          </Field>
          <Field label={copy.monogram}>
            <TextField
              label={copy.monogramLabel}
              value={monogram}
              onChange={(value) => setMonogram(value.toUpperCase())}
              placeholder={trimmed ? suggestedMonogramFor(trimmed) : copy.monogramPlaceholder}
              maxLength={4}
              onSubmit={create}
            />
          </Field>
          {error ? (
            <p className="m-0 text-[13px]" style={{ color: "var(--ff-danger)" }}>
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex" style={{ borderTop: "1px solid var(--ff-hairline-card)" }}>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-5 py-[13px] text-[14px]"
            style={{ color: "var(--ff-ink-3)" }}
          >
            {copy.cancel}
          </button>
          <button
            type="button"
            onClick={create}
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
