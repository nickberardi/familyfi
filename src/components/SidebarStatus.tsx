"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { noMembersAttention, syncStatusCard } from "@/lib/sync-copy";
import type { SyncStatus, UpdateCheck } from "@/lib/types";
import { updateAlert } from "@/lib/update-copy";
import { DeviceAttentionCard, SyncStatusCard, UpdateAlertCard } from "@/ui/StatusCards";

/**
 * The rail's status as one line each — an update on offer, whether the gateway is in sync, groups
 * that need a device — so the navigation keeps the rail's height. A row opens its shared card
 * (`src/ui/StatusCards.tsx`) in a popover beside the rail; the drawer and the native app show the
 * cards themselves.
 */
export function SidebarStatus({
  update,
  sync,
  busy,
  error,
  notice,
  onReconcile,
}: {
  update: UpdateCheck | null;
  sync: SyncStatus | null;
  busy: boolean;
  error?: string | null;
  notice?: string | null;
  onReconcile: () => void;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const [openedAt, setOpenedAt] = useState(pathname);
  // A link in a card navigates; the popover closes with the page it was opened on.
  if (pathname !== openedAt) {
    setOpenedAt(pathname);
    if (open) setOpen(null);
  }

  const alert = updateAlert(update);
  const status = syncStatusCard(sync, { busy, error, notice });
  const attention = noMembersAttention(sync?.issues ?? []);
  const rows = [
    alert
      ? { key: "update", title: alert.title, dot: "var(--ff-accent)", card: <UpdateAlertCard update={update} /> }
      : null,
    {
      key: "sync",
      title: status.title,
      dot: status.dot,
      card: <SyncStatusCard sync={sync} busy={busy} error={error} notice={notice} onReconcile={onReconcile} />,
    },
    attention
      ? { key: "devices", title: attention.title, dot: "var(--ff-paused)", card: <DeviceAttentionCard sync={sync} /> }
      : null,
  ].filter((row) => row !== null);

  // A row that goes away (the update installed, the groups got devices) takes its popover with it.
  if (open && !rows.some((row) => row.key === open)) setOpen(null);
  const close = useCallback(() => setOpen(null), []);

  return (
    <div className="flex flex-col gap-px">
      {rows.map((row) => (
        <StatusRow
          key={row.key}
          id={row.key}
          title={row.title}
          dot={row.dot}
          expanded={open === row.key}
          onToggle={() => setOpen((current) => (current === row.key ? null : row.key))}
          onClose={close}
        >
          {row.card}
        </StatusRow>
      ))}
    </div>
  );
}

function StatusRow({
  id,
  title,
  dot,
  expanded,
  onToggle,
  onClose,
  children,
}: {
  id: string;
  title: string;
  dot: string;
  expanded: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = `sidebar-status-${id}`;

  // The panel sits just right of the rail, its foot level with the row's, growing upward since
  // the rows sit at the rail's foot. Measured before paint so it never flashes in the wrong place.
  useLayoutEffect(() => {
    if (!expanded) return;
    function measure() {
      const row = button.current?.getBoundingClientRect();
      const rail = button.current?.closest("aside")?.getBoundingClientRect();
      const style = panel.current?.style;
      if (!row || !rail || !style) return;
      style.left = `${rail.right + 8}px`;
      style.bottom = `${Math.max(12, window.innerHeight - row.bottom)}px`;
      style.maxHeight = `${row.bottom - 12}px`;
    }
    measure();
    window.addEventListener("resize", measure);
    // Capture, so a scroll inside the rail keeps the panel level with its row too.
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    panel.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Only while the popover has focus, so Escape meant for a sheet opened over it stays with that sheet.
      const focused = document.activeElement;
      if (!panel.current?.contains(focused) && focused !== button.current) return;
      onClose();
      button.current?.focus();
    }
    function onPointer(event: PointerEvent) {
      const target = event.target as Node;
      if (panel.current?.contains(target) || button.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [expanded, onClose]);

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
        aria-haspopup="dialog"
        className="flex min-w-0 items-center gap-2.5 rounded-[7px] border-0 px-2.5 py-1.5 text-left text-[14px] font-medium text-[var(--ff-ink)]"
        style={{ background: expanded ? "var(--ff-accent-tint)" : "transparent" }}
      >
        <span aria-hidden className="h-2 w-2 flex-none rounded-full" style={{ background: dot }} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <Icon name="caret-right" size={14} />
      </button>
      {expanded ? (
        <div
          ref={panel}
          id={panelId}
          role="dialog"
          aria-label={title}
          tabIndex={-1}
          className="fixed z-[60] w-[280px] overflow-y-auto rounded-[10px] outline-none"
          style={{ boxShadow: "var(--ff-shadow-toast)" }}
        >
          {children}
        </div>
      ) : null}
    </>
  );
}
