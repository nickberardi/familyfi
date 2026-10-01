"use client";

import { request } from "@/lib/api";
import { NewCategoryForm } from "@/ui/NewCategoryForm";

/**
 * Adds a custom category over the Categories page. The form is shared with the native app
 * (`src/ui/NewCategoryForm.tsx`); the dialog is the web's.
 */
export function NewCategorySheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
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
        <NewCategoryForm request={request} onCreated={onCreated} onDone={onClose} />
      </div>
    </div>
  );
}
