"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { noMembersAttention, syncStatusCard } from "@/lib/sync-copy";
import type { SyncStatus, UpdateCheck } from "@/lib/types";
import { updateAlert } from "@/lib/update-copy";
import { DeviceAttentionCard, SyncStatusCard, UpdateAlertCard } from "@/ui/StatusCards";

/**
 * The rail's status: an update on offer, whether the gateway is in sync, groups that need a
 * device. They show as their shared cards (`src/ui/StatusCards.tsx`) while the rail has room. When
 * the cards would squeeze the navigation into a scroll, they collapse into one row, which names
 * the one notice or counts several and opens every card in a popover beside the rail. The drawer
 * and the native app show the cards themselves.
 */
export function SidebarStatus({
  update,
  sync,
  busy,
  error,
  notice,
  onReconcile,
  nav,
  navContent,
}: {
  update: UpdateCheck | null;
  sync: SyncStatus | null;
  busy: boolean;
  error?: string | null;
  notice?: string | null;
  onReconcile: () => void;
  /** The rail's scrolling navigation, and the content inside it, measured to decide when to collapse. */
  nav: React.RefObject<HTMLElement | null>;
  navContent: React.RefObject<HTMLElement | null>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(pathname);
  // A link in a card navigates; the popover closes with the page it was opened on.
  if (pathname !== openedAt) {
    setOpenedAt(pathname);
    if (open) setOpen(false);
  }

  const alert = updateAlert(update);
  const status = syncStatusCard(sync, { busy, error, notice });
  const attention = noMembersAttention(sync?.issues ?? []);
  // Whether sync needs a hand (failed, partial, not configured), whatever a write in flight says.
  const syncNotice = syncStatusCard(sync).showReconcile;
  // Most urgent first: the row takes the first one's dot.
  const notices = [
    syncNotice && status.dot === "var(--ff-danger)" ? { title: status.title, dot: status.dot } : null,
    attention ? { title: attention.title, dot: "var(--ff-paused)" } : null,
    alert ? { title: alert.title, dot: "var(--ff-accent)" } : null,
    syncNotice && status.dot !== "var(--ff-danger)" ? { title: status.title, dot: status.dot } : null,
  ].filter((item) => item !== null);
  const title = notices.length > 1 ? `${notices.length} notices` : (notices[0]?.title ?? status.title);
  const dot = notices[0]?.dot ?? status.dot;

  const cards = (
    <>
      <UpdateAlertCard update={update} />
      <SyncStatusCard sync={sync} busy={busy} error={error} notice={notice} onReconcile={onReconcile} />
      <DeviceAttentionCard sync={sync} />
    </>
  );

  // Collapse while the cards would push the navigation into a scroll, and expand again once the
  // rail has room for them. While collapsed, a hidden copy of the cards keeps their full height
  // measured as what they say changes, so the row never has to unmount (and drop focus) to look.
  const root = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  // The popover belongs to the collapsed row; it never waits to reopen on its own.
  if (!collapsed && open) setOpen(false);
  useLayoutEffect(() => {
    const rail = root.current?.closest("aside");
    if (!rail) return;
    function check() {
      const scroller = nav.current;
      const content = navContent.current;
      const own = root.current;
      const end = own?.parentElement;
      if (!scroller || !content || !own || !end) return;
      const slack = scroller.getBoundingClientRect().height - content.getBoundingClientRect().height;
      if (!collapsed) {
        if (slack < -0.5 || end.scrollHeight > end.clientHeight + 1) setCollapsed(true);
        return;
      }
      const copy = ghost.current;
      // Not under an open popover, which would close with focus inside it; it re-checks on close.
      if (!copy || open) return;
      copy.style.width = `${own.getBoundingClientRect().width}px`;
      // A few pixels' margin, so a height on the edge settles rather than flipping back and forth.
      if (slack + own.getBoundingClientRect().height >= copy.getBoundingClientRect().height + 4) setCollapsed(false);
    }
    check();
    const observer = new ResizeObserver(check);
    for (const element of [rail, nav.current, navContent.current, root.current, ghost.current]) if (element) observer.observe(element);
    return () => observer.disconnect();
  }, [collapsed, open, nav, navContent]);

  const close = useCallback(() => setOpen(false), []);

  return (
    <div ref={root} className="flex flex-col gap-2.5">
      {collapsed ? (
        <StatusRow id="notices" title={title} dot={dot} expanded={open} onToggle={() => setOpen((current) => !current)} onClose={close}>
          <div className="flex flex-col gap-2.5 rounded-[10px] p-2.5" style={{ background: "var(--ff-rail)" }}>
            {cards}
          </div>
        </StatusRow>
      ) : null}
      {collapsed ? (
        // Fixed and off screen, so it adds nothing to the rail's scroll height.
        <div ref={ghost} aria-hidden inert className="pointer-events-none invisible fixed top-0 left-[-10000px] flex flex-col gap-2.5">
          {cards}
        </div>
      ) : (
        cards
      )}
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
          // A link in the card may stay on this page (`/devices?assign=…` from Devices), so following one closes it.
          onClickCapture={(event) => {
            if ((event.target as Element).closest("a")) onClose();
          }}
          // Tabbing past the card closes it, as a click outside does.
          onBlur={(event) => {
            const next = event.relatedTarget as Node | null;
            if (next && !panel.current?.contains(next) && next !== button.current) onClose();
          }}
        >
          {children}
        </div>
      ) : null}
    </>
  );
}
