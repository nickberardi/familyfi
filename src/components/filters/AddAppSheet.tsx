"use client";

/**
 * "Add app filter": a member-page action only. Categories are a fixed catalog with nothing to add,
 * so only app rules get an entry point, and never from the family-list card. The form is shared
 * with the native app (`src/ui/AddAppForm.tsx`); the dialog is the web's.
 */

import { request } from "@/lib/api";
import { useAppData } from "@/components/AppDataProvider";
import type { Group } from "@/lib/types";
import { AddAppForm } from "@/ui/AddAppForm";

export function AddAppSheet({ group, onClose, onCreated }: { group: Group; onClose: () => void; onCreated: () => void }) {
  const { store } = useAppData();
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
        <AddAppForm group={group} request={request} mutate={store.mutate} onCreated={onCreated} onDone={onClose} />
      </div>
    </div>
  );
}
