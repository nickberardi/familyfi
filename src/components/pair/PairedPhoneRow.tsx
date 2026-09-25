"use client";

import { transportLabel } from "@/lib/connection-routes";
import { relativeSweep } from "@/lib/sync-copy";
import type { PairedPhone } from "@/lib/types";
import { Icon } from "@/components/ui/Icon";

function pairedDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Each paired device has its own sessions and can be revoked independently. */
export function PairedPhoneRow({
  phone,
  onRevoke,
  onRepair,
  onRemove,
}: {
  phone: PairedPhone;
  onRevoke?: () => void;
  onRepair?: () => void;
  onRemove?: () => void;
}) {
  const seen = phone.lastSeenAt ? relativeSweep(phone.lastSeenAt) : "never";
  return (
    <div data-testid="phone-row" className="flex flex-wrap items-center gap-3 border-t border-[var(--ff-hairline)] px-[18px] py-3 first:border-t-0">
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[var(--ff-field)]">
        <Icon name={phone.client === "watch" ? "watch" : "device-mobile"} size={18} />
      </span>
      <div className="min-w-[200px] flex-1">
        <div className="text-[14px] font-semibold">{phone.displayName}</div>
        <div className="mt-0.5 text-[14px] text-[var(--ff-muted)]">
          Paired {pairedDate(phone.enrolledAt)} · {phone.revokedAt ? `revoked ${pairedDate(phone.revokedAt)}` : `last seen ${seen === "now" || seen === "never" ? seen : `${seen} ago`}`}
        </div>
        <div className="mt-0.5 text-[14px] text-[var(--ff-muted)]">
          {phone.pairedVia ? (
            <>
              via <span className="font-mono">{phone.pairedVia.url}</span> · {transportLabel(phone.pairedVia.transport)}
            </>
          ) : (
            phone.client === "watch" ? "Paired automatically from an iPhone" : "via a route that was removed"
          )}
        </div>
      </div>
      {phone.sessions.map((session) => (
        <div key={session.id} className="w-full pl-11 text-[14px] text-[var(--ff-muted)]">
          {session.username} · expires {pairedDate(session.expiresAt)}
        </div>
      ))}
      {onRevoke ? (
        <button type="button" className="text-[14px] font-semibold text-[var(--ff-danger)]" onClick={onRevoke}>
          Revoke
        </button>
      ) : null}
      {onRepair ? (
        <button type="button" className="text-[14px] font-semibold text-[var(--ff-accent)]" onClick={onRepair}>
          Re-pair
        </button>
      ) : null}
      {onRemove ? (
        <button type="button" className="text-[14px] font-semibold text-[var(--ff-danger)]" onClick={onRemove}>
          Remove
        </button>
      ) : null}
    </div>
  );
}
