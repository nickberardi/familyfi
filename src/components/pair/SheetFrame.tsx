"use client";

import { useId, type ReactNode } from "react";

import { Modal, type ModalSize } from "@/components/ui/Modal";

export { CANCEL_BUTTON, DESTRUCTIVE_BUTTON, FIELD, PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/ui/buttons";

/**
 * A dialog with a title, an optional line under it, its content and a footer of actions:
 * Cancel on the left of the main action, right-aligned, with no divider. `confirm` (400px) is
 * a decision about something that exists; `form` (520px) creates or edits one.
 */
export function SheetFrame({
  title,
  sub,
  size,
  onClose,
  children,
  footer,
  raised,
  testID,
}: {
  title: string;
  size: ModalSize;
  sub?: string;
  onClose: () => void;
  children?: ReactNode;
  footer: ReactNode;
  raised?: boolean;
  testID?: string;
}) {
  const titleId = useId();
  return (
    <Modal labelledBy={titleId} size={size} onClose={onClose} raised={raised} testID={testID}>
      <div className="px-[18px] pt-[18px] pb-1">
        <h2 id={titleId} className="text-[17px] leading-[24px] font-semibold tracking-tight">
          {title}
        </h2>
        {sub ? <p className="mt-1.5 text-[14px] leading-5 text-[var(--ff-ink-2)]">{sub}</p> : null}
      </div>
      {children ? <div className="flex flex-col gap-3 px-[18px] py-3.5">{children}</div> : <div className="h-2" />}
      <div className="flex flex-wrap items-center justify-end gap-2 px-[18px] pt-1 pb-[18px]">{footer}</div>
    </Modal>
  );
}
