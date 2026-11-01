"use client";

import { Modal } from "@/components/ui/Modal";
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
    <Modal labelledBy="new-group-title" size="form" onClose={onClose}>
      <NewGroupForm kind={kind} mutate={store.mutate} onDone={onClose} />
    </Modal>
  );
}
