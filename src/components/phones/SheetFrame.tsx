import type { ReactNode } from "react";

export const PRIMARY_BUTTON =
  "rounded-lg bg-[var(--ff-accent)] px-3.5 py-2 text-[14px] font-semibold text-[var(--ff-ink-on-fill)] disabled:opacity-40";
export const SECONDARY_BUTTON =
  "rounded-lg border border-[var(--ff-line)] px-3.5 py-2 text-[14px] font-semibold text-[var(--ff-accent)] disabled:opacity-40";
export const FIELD =
  "mt-1 w-full rounded-lg border border-[var(--ff-line)] px-3 py-2.5 text-[16px] font-normal text-[var(--ff-ink)]";

/** The modal frame the two Phones sheets share: scrim, card, title and a footer row. */
export function SheetFrame({
  title,
  sub,
  onClose,
  children,
  footer,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-[var(--ff-scrim)] p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="my-auto w-full max-w-[440px] overflow-hidden rounded-[14px] bg-[var(--ff-card)] shadow-[var(--ff-shadow-sheet)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-[18px] pt-[18px] pb-1">
          <div className="text-[17px] font-bold tracking-tight">{title}</div>
          {sub ? <p className="mt-1 text-[14px] leading-5 text-[var(--ff-muted)]">{sub}</p> : null}
        </div>
        <div className="flex flex-col gap-3 px-[18px] py-3.5">{children}</div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--ff-hairline-card)] px-[18px] py-3">{footer}</div>
      </div>
    </div>
  );
}
