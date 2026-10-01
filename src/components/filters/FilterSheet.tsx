"use client";
/**
 * The popover behind a filter mark. What it says and sends is shared with the native app
 * (`src/lib/filter-sheet.ts`); the popover is the web's own.
 */

import type { CategorySheetState } from "@/lib/category-marks";
import { useState } from "react";
import Link from "next/link";
import { applyFilterAction, filterRuleName, filterSheetCopy } from "@/lib/filter-sheet";
import { useAppData } from "@/components/AppDataProvider";
import type { Group } from "@/lib/types";
import { NetworkCheckDetails } from "@/components/upstream/NetworkCheckDetails";

/** What a mark opens (`src/lib/category-marks.ts`). */
export type FilterSheetState = CategorySheetState;

export function FilterSheet({
  group,
  state,
  onClose,
  onChanged,
}: {
  group: Group;
  state: FilterSheetState;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { mutate } = useAppData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const copy = filterSheetCopy(group, state);
  const upstream = state.kind === "category" ? state.upstream : null;
  const websitesHref =
    state.kind === "category"
      ? `/rules/new?kind=domain&group=${group.id}&name=${encodeURIComponent(filterRuleName(group, state))}${
          state.domains.length ? `&domains=${encodeURIComponent(state.domains.join(","))}` : ""
        }`
      : "";

  async function run() {
    if (busy || copy.action === "websites") return;
    setBusy(true);
    setError("");
    try {
      await applyFilterAction(mutate, group, state, copy.action);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the rule.");
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
      aria-labelledby="filter-sheet-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[360px] overflow-hidden rounded-[14px]"
        style={{ background: "var(--ff-card)", boxShadow: "var(--ff-shadow-sheet)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col gap-2.5 p-5">
          <h2 id="filter-sheet-title" className="text-[16px] font-bold tracking-tight">
            {copy.heading}
          </h2>
          <p className="text-[13px] leading-snug" style={{ color: "var(--ff-ink-3)" }}>
            {copy.body}
          </p>
          {copy.windows.length ? (
            <ul className="text-[13px] leading-snug" style={{ color: "var(--ff-ink-2)" }}>
              {copy.windows.map((line, index) => (
                <li key={state.rule?.windows[index]?.id ?? index}>{line}</li>
              ))}
            </ul>
          ) : null}
          <NetworkCheckDetails check={upstream} />
          {error ? (
            <p className="text-[13px]" style={{ color: "var(--ff-danger)" }}>
              {error}
            </p>
          ) : null}
          {copy.action === "websites" ? (
            <Link
              href={websitesHref}
              className="mt-1 rounded-[9px] py-2.5 text-center text-[14px] font-semibold"
              style={{ background: "var(--ff-accent)", color: "var(--ff-ink-on-fill)" }}
            >
              {copy.actionLabel}
            </Link>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run()}
                className="mt-1 rounded-[9px] py-2.5 text-center text-[14px] font-semibold disabled:opacity-50"
                style={
                  copy.action === "turnOff"
                    ? { background: "var(--ff-danger-fill)", color: "var(--ff-danger)" }
                    : { background: "var(--ff-accent)", color: "var(--ff-ink-on-fill)" }
                }
              >
                {copy.actionLabel}
              </button>
              <Link
                href={
                  state.rule
                    ? `/rules/${state.rule.id}`
                    : `/rules/new?kind=category&target=${state.kind === "category" ? state.categoryId : ""}&group=${group.id}`
                }
                className="text-center text-[14px] font-semibold"
                style={{ color: "var(--ff-accent)" }}
              >
                {copy.editLabel}
              </Link>
            </>
          )}
        </div>
        <button
          type="button"
          className="w-full py-3 text-center text-[14px]"
          style={{ borderTop: "1px solid var(--ff-hairline-card)", color: "var(--ff-ink-3)" }}
          onClick={onClose}
        >
          {copy.cancel}
        </button>
      </div>
    </div>
  );
}
