"use client";

import { useAppData } from "@/components/AppDataProvider";
import { NewGroupForm } from "@/ui/NewGroupForm";

/**
 * Adds a family member or a Things group over the page it was opened from, like adding a
 * category. Devices are assigned afterwards, so a name (and a role, or a monogram) is all
 * it asks for; the new card appears in place.
 */
export function NewGroupSheet({ kind, onClose }: { kind: "family" | "things"; onClose: () => void }) {
  const { store } = useAppData();

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
        <NewGroupForm kind={kind} mutate={store.mutate} onDone={onClose} />
      </div>
    </div>
  );
}
