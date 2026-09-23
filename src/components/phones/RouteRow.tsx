"use client";

import { shortPin, transportLabel } from "@/lib/connection-routes";
import type { ConnectionRoute } from "@/lib/types";
import { TogglePill } from "@/components/ui/Controls";

const LINK = "text-[14px] font-semibold text-[var(--ff-accent)] disabled:opacity-40";

export function RouteRow({
  route,
  first,
  last,
  phones,
  onToggle,
  onMove,
  onEdit,
  onDelete,
}: {
  route: ConnectionRoute;
  first: boolean;
  last: boolean;
  /** Active phones that paired through this route — the ones a change would strand. */
  phones: number;
  onToggle: () => void;
  onMove: (direction: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div data-testid="route-row" className="flex flex-wrap items-center gap-3 border-t border-[var(--ff-hairline)] px-[18px] py-3 first:border-t-0">
      <div className="flex flex-none flex-col">
        <button type="button" aria-label={`Move ${route.url} up`} disabled={first} className="px-1 text-[14px] text-[var(--ff-muted)] disabled:opacity-30" onClick={() => onMove(-1)}>
          ▲
        </button>
        <button type="button" aria-label={`Move ${route.url} down`} disabled={last} className="px-1 text-[14px] text-[var(--ff-muted)] disabled:opacity-30" onClick={() => onMove(1)}>
          ▼
        </button>
      </div>
      <div className="min-w-[200px] flex-1">
        <div className="font-mono text-[14px] break-all">{route.url}</div>
        <div className="mt-0.5 text-[14px] text-[var(--ff-muted)]">
          {transportLabel(route.transport)} ·{" "}
          {route.trustMode === "pinned" && route.spkiSha256 ? (
            <>
              Pinned <span className="font-mono">{shortPin(route.spkiSha256)}</span>
            </>
          ) : (
            "Ordinary certificate checks"
          )}
          {phones ? ` · ${phones} phone${phones === 1 ? "" : "s"} paired here` : ""}
        </div>
      </div>
      <TogglePill on={route.enabled} onToggle={onToggle} label={`${route.url} enabled`} onLabel="Enabled" offLabel="Off" />
      <button type="button" className={LINK} onClick={onEdit}>
        Edit
      </button>
      <button type="button" className="text-[14px] font-semibold text-[var(--ff-danger)]" onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}
