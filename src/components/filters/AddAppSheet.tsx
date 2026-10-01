"use client";

/**
 * "Add app filter" — a member-page action only.
 *
 * Categories are a fixed catalog with nothing to add, so only app rules get an
 * entry point, and never from the family-list card.
 */

import { useEffect, useState } from "react";
import { request } from "@/lib/api";
import { addAppCopy, createAppRule } from "@/lib/filter-sheet";
import { searchCatalog } from "@/lib/rule-catalog";
import { useAppData } from "@/components/AppDataProvider";
import { Segmented } from "@/components/ui/Segmented";
import type { Group } from "@/lib/types";

type DpiItem = { id: number; name: string };

export function AddAppSheet({
  group,
  onClose,
  onCreated,
}: {
  group: Group;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { store } = useAppData();
  const copy = addAppCopy(group);
  const [filter, setFilter] = useState("");
  const [catalog, setCatalog] = useState<DpiItem[]>([]);
  const [selectedDpiId, setSelectedDpiId] = useState<number | "">("");
  const [enforcement, setEnforcement] = useState<"always" | "scheduled">("always");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void searchCatalog(request, "app", filter)
      .then((items) => {
        if (cancelled) return;
        setCatalog(items);
        setError("");
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setCatalog([]);
        setError(err.message || copy.loadFailed);
      });
    return () => {
      cancelled = true;
    };
  }, [filter, copy.loadFailed]);

  const canCreate = selectedDpiId !== "" && !busy;

  async function create() {
    if (!canCreate) return;
    setBusy(true);
    setError("");
    try {
      await createAppRule(store.mutate, group, catalog.find((item) => item.id === selectedDpiId), selectedDpiId, enforcement);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the rule.");
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
      aria-labelledby="add-app-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] overflow-hidden rounded-[14px]"
        style={{ background: "var(--ff-card)", boxShadow: "var(--ff-shadow-sheet)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-5 pb-1 pt-[18px]">
          <h2 id="add-app-title" className="text-[17px] font-bold tracking-tight">
            {copy.title}
          </h2>
          <p className="mt-1 text-[13px] leading-snug" style={{ color: "var(--ff-ink-3)" }}>
            {copy.body}
          </p>
        </div>

        <div className="flex flex-col gap-3.5 px-5 py-4">
          <div>
            <div className="mb-1.5 text-[12px] font-semibold" style={{ color: "var(--ff-ink-3)" }}>
              {copy.app}
            </div>
            <input
              type="search"
              placeholder={copy.search}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="mb-2 w-full rounded-lg border px-3 py-2 text-[15px]"
              style={{ borderColor: "var(--ff-line)" }}
            />
            <select
              className="w-full rounded-lg border px-3 py-2.5 text-[16px]"
              style={{ borderColor: "var(--ff-line)" }}
              value={selectedDpiId === "" ? "" : String(selectedDpiId)}
              onChange={(e) => setSelectedDpiId(e.target.value ? Number(e.target.value) : "")}
              aria-label={copy.picker}
            >
              <option value="">{copy.pick}</option>
              {catalog.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="mb-1.5 text-[12px] font-semibold" style={{ color: "var(--ff-ink-3)" }}>
              {copy.enforcement}
            </div>
            <Segmented
              name={copy.enforcement}
              grow
              value={enforcement}
              onChange={setEnforcement}
              segments={[
                { value: "always", label: copy.always },
                { value: "scheduled", label: copy.scheduled },
              ]}
            />
          </div>

          {error ? (
            <p className="text-[13px]" style={{ color: "var(--ff-danger)" }}>
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex" style={{ borderTop: "1px solid var(--ff-hairline-card)" }}>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 text-center text-[14px]"
            style={{ color: "var(--ff-ink-3)" }}
          >
            {copy.cancel}
          </button>
          <button
            type="button"
            disabled={!canCreate}
            onClick={() => void create()}
            className="flex-1 py-3 text-center text-[14px] font-semibold disabled:cursor-not-allowed"
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
