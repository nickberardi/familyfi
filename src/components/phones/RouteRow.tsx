"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { shortPin, transportLabel } from "@/lib/connection-routes";
import type { CertificatePin, ConnectionRoute } from "@/lib/types";
import { TogglePill } from "@/components/ui/Controls";

const LINK = "text-[14px] font-semibold text-[var(--ff-accent)] disabled:opacity-40";

type Check = { tone: "ok" | "bad" | "unknown"; text: string };

/** Compares a pinned route against the certificate it serves right now, from FamilyFi's side. */
async function checkPin(route: ConnectionRoute): Promise<Check> {
  try {
    const { pin } = await api<{ pin: CertificatePin }>("/api/v1/connection/pins", { method: "POST", body: JSON.stringify({ url: route.url }) });
    return pin.spkiSha256 === route.spkiSha256
      ? { tone: "ok", text: "Matches the certificate this address serves now." }
      : { tone: "bad", text: `Doesn't match — this address now serves ${shortPin(pin.spkiSha256)}. Phones will refuse this route until you update the pin.` };
  } catch (caught) {
    // Could not look is not the same as fine: say so, never imply a match.
    return { tone: "unknown", text: `Couldn't check from FamilyFi: ${caught instanceof ApiError ? caught.message : "request failed."}` };
  }
}

const CHECK_INK: Record<Check["tone"], string> = { ok: "var(--ff-on-ink)", bad: "var(--ff-danger)", unknown: "var(--ff-muted)" };

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
  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  const pinned = route.trustMode === "pinned" && route.spkiSha256;
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
        {check ? (
          <div data-testid="pin-check" role="status" className="mt-0.5 text-[14px] font-semibold" style={{ color: CHECK_INK[check.tone] }}>
            {check.text}
          </div>
        ) : null}
      </div>
      <TogglePill on={route.enabled} onToggle={onToggle} label={`${route.url} enabled`} onLabel="Enabled" offLabel="Off" />
      {pinned ? (
        <button
          type="button"
          className={LINK}
          disabled={checking}
          onClick={() => {
            setChecking(true);
            void checkPin(route).then((result) => {
              setCheck(result);
              setChecking(false);
            });
          }}
        >
          {checking ? "Checking…" : "Check"}
        </button>
      ) : null}
      <button type="button" className={LINK} onClick={onEdit}>
        Edit
      </button>
      <button type="button" className="text-[14px] font-semibold text-[var(--ff-danger)]" onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}
