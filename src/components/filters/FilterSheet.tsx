"use client";
/**
 * The popover behind a filter mark. What it says and sends is shared with the native app
 * (`src/lib/filter-sheet.ts`); the popover is the web's own.
 */

import { Modal } from "@/components/ui/Modal";
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
}: {
  group: Group;
  state: FilterSheetState;
  onClose: () => void;
}) {
  const { mutate, store } = useAppData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const copy = filterSheetCopy(group, state);
  const upstream = state.kind === "category" ? state.upstream : null;

  async function run() {
    if (busy || copy.action === "websites") return;
    setBusy(true);
    setError("");
    try {
      // The store reloads once the change lands. A write it refused stays open, saying why.
      const result = await applyFilterAction(mutate, group, state, copy.action);
      if (result === undefined) {
        setError(store.getState().error || "Could not change the rule.");
        return;
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the rule.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal labelledBy="filter-sheet-title" size="confirm" onClose={onClose}>
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
    </Modal>
  );
}
