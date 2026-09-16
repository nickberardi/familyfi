import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  sub,
  actionHref,
  actionLabel,
  onAction,
}: {
  title: string;
  sub: string;
  actionHref?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  let action: ReactNode = null;
  if (actionHref && actionLabel) {
    action = (
      <Link href={actionHref} className="rounded-lg bg-[var(--ff-accent)] px-3.5 py-2 text-[14px] font-semibold text-white">
        {actionLabel}
      </Link>
    );
  } else if (onAction && actionLabel) {
    action = (
      <button
        type="button"
        onClick={onAction}
        className="rounded-lg bg-[var(--ff-accent)] px-3.5 py-2 text-[14px] font-semibold text-white"
      >
        {actionLabel}
      </button>
    );
  }

  return (
    <header className="sticky top-0 z-20 flex items-center gap-3.5 border-b border-[var(--ff-line)] bg-[var(--ff-header-wash)] px-4 py-4 backdrop-blur md:px-6">
      <div className="min-w-0 flex-1">
        <h1 className="m-0 text-[21px] font-bold tracking-tight">{title}</h1>
        <p className="mt-0.5 text-[14px] text-[var(--ff-muted)]">{sub}</p>
      </div>
      {action}
    </header>
  );
}
