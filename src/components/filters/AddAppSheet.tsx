"use client";

/**
 * "Add app filter": a member-page action only. Categories are a fixed catalog with nothing to add,
 * so only app rules get an entry point, and never from the family-list card. The form is shared
 * with the native app (`src/ui/AddAppForm.tsx`); the dialog is the web's.
 */

import { Modal } from "@/components/ui/Modal";
import { request } from "@/lib/api";
import { useAppData } from "@/components/AppDataProvider";
import type { Group } from "@/lib/types";
import { AddAppForm } from "@/ui/AddAppForm";

export function AddAppSheet({ group, onClose }: { group: Group; onClose: () => void }) {
  const { store } = useAppData();
  return (
    <Modal labelledBy="add-app-title" size="form" onClose={onClose}>
      <AddAppForm group={group} request={request} mutate={store.mutate} onDone={onClose} />
    </Modal>
  );
}
