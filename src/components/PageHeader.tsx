import Link from "next/link";
import type { ReactNode } from "react";
import { useNavDrawer } from "./AppShell";

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
  const { toggle } = useNavDrawer();
  let action: ReactNode = null;
  if (actionHref && actionLabel) {
    action = (
      <Link href={actionHref} className="rounded-lg bg-[var(--ff-accent)] px-3.5 py-2 text-[14px] font-semibold text-[var(--ff-ink-on-fill)]">
        {actionLabel}
      </Link>
    );
  } else if (onAction && actionLabel) {
    action = (
      <button
        type="button"
        onClick={onAction}
        className="rounded-lg bg-[var(--ff-accent)] px-3.5 py-2 text-[14px] font-semibold text-[var(--ff-ink-on-fill)]"
      >
        {actionLabel}
      </button>
    );
  }

  return (
    <header className="sticky top-0 z-20 flex items-center gap-3.5 border-b border-[var(--ff-line)] bg-[var(--ff-header-wash)] px-4 py-4 backdrop-blur md:px-6">
      <button
        type="button"
        aria-label="Open navigation"
        onClick={toggle}
        className="flex h-8 w-8 flex-none items-center justify-center rounded-[8px] text-[17px] md:hidden"
        style={{ background: "var(--ff-field)", color: "var(--ff-ink)" }}
      >
        ☰
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="m-0 text-[21px] font-bold tracking-tight">{title}</h1>
        <p className="mt-0.5 text-[14px] text-[var(--ff-muted)]">{sub}</p>
      </div>
      {action}
    </header>
  );
}
