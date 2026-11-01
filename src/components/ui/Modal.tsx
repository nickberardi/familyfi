"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * The web's one dialog frame: scrim, card, focus kept inside, Escape and a click on the scrim
 * close it, and focus returns to what opened it. `confirm` (400px) is a decision about something
 * that already exists; `form` (520px) creates or edits one. The phone draws the same content in
 * its own sheet.
 */
export type ModalSize = "confirm" | "form";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Open dialogs, innermost last: Escape closes only the top one (a confirm over an Edit sheet). */
const open: object[] = [];

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((item) => item.getAttribute("aria-hidden") !== "true");
}

export function Modal({
  label,
  labelledBy,
  size,
  onClose,
  children,
  raised = false,
  testID,
}: {
  /** Its accessible name, when no heading inside names it. */
  label?: string;
  /** The id of the heading inside that names it. */
  labelledBy?: string;
  size: ModalSize;
  onClose: () => void;
  children: ReactNode;
  /** Above another dialog: a confirm asked from inside a sheet. */
  raised?: boolean;
  testID?: string;
}) {
  const card = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  // Read while rendering: React applies a child's autoFocus before any effect runs, so by then
  // the focused element is already inside the dialog.
  const [opener] = useState(() => (typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null));
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const self = {};
    open.push(self);
    const root = card.current;
    // A field the content focused itself keeps focus; otherwise the dialog takes it, so Tab starts inside.
    if (root && !root.contains(document.activeElement)) root.focus();
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || open[open.length - 1] !== self) return;
      event.preventDefault();
      close.current();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      open.splice(open.indexOf(self), 1);
      if (opener?.isConnected) opener.focus();
    };
  }, [opener]);

  /** Tab and Shift+Tab cycle within the dialog, so the page behind the scrim can't be reached from the keyboard. */
  function keepFocusInside(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const items = focusables(event.currentTarget);
    if (!items.length) {
      event.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className={`fixed inset-0 ${raised ? "z-[90]" : "z-[81]"} flex items-center justify-center overflow-y-auto bg-[var(--ff-scrim)] p-4`} onClick={onClose}>
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        data-testid={testID}
        className={`my-auto w-full ${size === "form" ? "max-w-[var(--ff-dialog-form)]" : "max-w-[var(--ff-dialog-confirm)]"} overflow-hidden rounded-[14px] bg-[var(--ff-card)] shadow-[var(--ff-shadow-sheet)] outline-none`}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={keepFocusInside}
      >
        {children}
      </div>
    </div>
  );
}
