"use client";

import { useEffect, useSyncExternalStore } from "react";

import type { UIConfirmRequest } from "@/ui/UIContext";

import { CANCEL_BUTTON, DESTRUCTIVE_BUTTON, PRIMARY_BUTTON, SheetFrame } from "@/components/pair/SheetFrame";

/**
 * The web's confirmation: a 400px dialog with the consequence under its title, Cancel on the
 * left and the action, red when it removes something, on the right. `askConfirm` is what
 * `useUI().confirm` calls on the web; `ConfirmHost`, mounted once in the root layout, draws it.
 */
type Pending = UIConfirmRequest & { resolve: (go: boolean) => void };

let pending: Pending | null = null;
const listeners = new Set<() => void>();

function publish(next: Pending | null) {
  pending = next;
  for (const listener of listeners) listener();
}

// Answered only while a ConfirmHost is mounted, which the root layout guarantees.
export function askConfirm(request: UIConfirmRequest): Promise<boolean> {
  // A second question while one is open declines the first: only one is ever answered.
  pending?.resolve(false);
  return new Promise((resolve) => publish({ ...request, resolve }));
}

function answer(go: boolean) {
  const current = pending;
  publish(null);
  current?.resolve(go);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function ConfirmHost() {
  const request = useSyncExternalStore(
    subscribe,
    () => pending,
    () => null,
  );
  // Going Back leaves the page that asked, so the question is declined rather than left over the next one.
  useEffect(() => {
    if (!request) return;
    const decline = () => answer(false);
    window.addEventListener("popstate", decline);
    return () => window.removeEventListener("popstate", decline);
  }, [request]);
  if (!request) return null;
  return (
    <SheetFrame
      title={request.title}
      sub={request.message}
      size="confirm"
      raised
      onClose={() => answer(false)}
      testID="confirm-dialog"
      footer={
        <>
          <button type="button" autoFocus className={CANCEL_BUTTON} onClick={() => answer(false)}>
            {request.cancelLabel ?? "Cancel"}
          </button>
          <button type="button" className={request.destructive ? DESTRUCTIVE_BUTTON : PRIMARY_BUTTON} onClick={() => answer(true)}>
            {request.confirmLabel}
          </button>
        </>
      }
    />
  );
}
