"use client";

import { Modal } from "@/components/ui/Modal";
import { request } from "@/lib/api";
import { NewCategoryForm } from "@/ui/NewCategoryForm";

/**
 * Adds a custom category over the Categories page. The form is shared with the native app
 * (`src/ui/NewCategoryForm.tsx`); the dialog is the web's.
 */
export function NewCategorySheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  return (
    <Modal labelledBy="new-category-title" size="form" onClose={onClose}>
      <NewCategoryForm request={request} onCreated={onCreated} onDone={onClose} />
    </Modal>
  );
}
