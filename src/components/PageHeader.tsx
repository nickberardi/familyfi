import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { useNavDrawer } from "./AppShell";
import { PRIMARY_BUTTON } from "@/components/ui/buttons";

export function PageHeader({
  title,
  sub,
  actionHref,
  actionLabel,
  onAction,
  secondary,
}: {
  title: string;
  sub?: string;
  actionHref?: string;
  actionLabel?: string;
  /** Gets the click, so a sheet the action opens can hand focus back to the button. */
  onAction?: (event: MouseEvent<HTMLButtonElement>) => void;
  /** A second, lesser header action, before the primary one. */
  secondary?: ReactNode;
}) {
  const { toggle } = useNavDrawer();
  let action: ReactNode = null;
  if (actionHref && actionLabel) {
    action = (
      <Link href={actionHref} className={PRIMARY_BUTTON}>
        {actionLabel}
      </Link>
    );
  } else if (onAction && actionLabel) {
    action = (
      <button
        type="button"
        onClick={onAction}
        className={PRIMARY_BUTTON}
      >
        {actionLabel}
      </button>
    );
  }

  return (
    /* The header wash is the only blur in the product — hence a token, not a utility. */
    <header
      className="sticky top-0 z-20 flex flex-wrap items-center gap-3.5 border-b border-[var(--ff-line)] bg-[var(--ff-header-wash)] px-4 py-4 md:px-6"
      style={{ backdropFilter: "var(--ff-blur-header)" }}
    >
      <button
        type="button"
        aria-label="Open navigation"
        onClick={toggle}
        className="flex h-8 w-8 flex-none items-center justify-center rounded-[8px] text-[17px] md:hidden"
        style={{ background: "var(--ff-field)", color: "var(--ff-ink)" }}
      >
        ☰
      </button>
      {/* At least 16rem, so on a phone the actions wrap under the title rather than squeezing it to a word a line. */}
      <div className="min-w-[min(100%,16rem)] flex-1">
        <h1 className="m-0 text-[21px] leading-[1.2] font-bold tracking-tight">{title}</h1>
        {sub ? <p className="mt-0.5 text-[14px] leading-[1.25] text-[var(--ff-muted)]">{sub}</p> : null}
      </div>
      {secondary || action ? (
        // Right-aligned, so on a phone the actions wrap under the title with the primary right-most.
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {secondary}
          {action}
        </div>
      ) : null}
    </header>
  );
}
