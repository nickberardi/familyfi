"use client";
/**
 * The popover behind a filter mark. What it says and sends is shared with the native app
 * (`src/lib/filter-sheet.ts`); the popover is the web's own.
 */

import type { CategorySheetState } from "@/lib/category-marks";
import { useState } from "react";
import { applyFilterAction, filterEditHref, filterSheetCopy, filterWebsitesHref } from "@/lib/filter-sheet";
import { useAppData } from "@/components/AppDataProvider";
import type { Group } from "@/lib/types";
import { NetworkCheckDetails } from "@/components/upstream/NetworkCheckDetails";
import { FilterSheetContent } from "@/ui/FilterSheetContent";

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
        <FilterSheetContent
          copy={copy}
          busy={busy}
          error={error}
          details={<NetworkCheckDetails check={upstream} />}
          websitesHref={filterWebsitesHref(group, state)}
          editHref={filterEditHref(group, state)}
          onAction={() => void run()}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}
