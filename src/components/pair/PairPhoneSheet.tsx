"use client";

import { useState } from "react";
import { countdown, transportLabel } from "@/lib/connection-routes";
import type { ConnectionRoute, PairedPhone } from "@/lib/types";
import { CopyRow } from "@/components/ui/CopyRow";
import { QrCode } from "@/components/ui/QrCode";
import { usePairingCode } from "./pairing-code-session";
import { FIELD, PRIMARY_BUTTON, SECONDARY_BUTTON, SheetFrame } from "./SheetFrame";

/**
 * Pair a phone through the published route: name the phone, then show the single-use pairing code,
 * as a QR and as text to copy. Both are the same string, the only one the app accepts. Closing the sheet or
 * regenerating cancels a code nobody claimed, so a QR left on screen dies with it.
 */
export function PairPhoneSheet({
  route,
  replacing,
  onClose,
  onPaired,
}: {
  /** The one route Remote access publishes: the address the phone pairs over. */
  route: ConnectionRoute;
  /** Re-pairing: the (usually revoked) phone this pairing replaces once it is claimed. */
  replacing?: PairedPhone | null;
  onClose: () => void;
  onPaired: () => void;
}) {
  const [name, setName] = useState(replacing?.displayName ?? "iPhone");
  const { issued, state, expired, claimed, remaining, error, busy, generate } = usePairingCode({
    body: () => ({ endpointId: route.id, deviceName: name.trim(), ...(replacing ? { replacesDeviceId: replacing.id } : {}) }),
    onClaimed: onPaired,
  });

  if (!issued) {
    return (
      <SheetFrame
        title={replacing ? `Re-pair ${replacing.displayName}` : "Pair a phone"}
        sub={
          replacing
            ? "Makes a new single-use code for this phone. Once the phone uses it, its old entry is removed from the list."
            : "Makes a single-use code that lets one phone join this household. It expires in five minutes and does not sign anyone in."
        }
        onClose={onClose}
        footer={
          <>
            <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={PRIMARY_BUTTON} disabled={busy || !name.trim()} onClick={() => void generate()}>
              Show pairing code
            </button>
          </>
        }
      >
        <div className="text-[14px] font-semibold text-[var(--ff-muted)]">
          Route
          <div data-testid="pairing-route" className="mt-1 font-normal text-[var(--ff-ink)]">
            <span className="font-mono break-all">{route.url}</span> · {transportLabel(route.transport)}
          </div>
          <span className="mt-1 block font-normal">The phone must reach this address while it pairs. Change it under Remote access.</span>
        </div>
        <label className="text-[14px] font-semibold text-[var(--ff-muted)]">
          Phone
          <input className={FIELD} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        </label>
        {error ? (
          <p role="alert" className="text-[14px] font-semibold text-[var(--ff-danger)]">
            {error}
          </p>
        ) : null}
      </SheetFrame>
    );
  }

  return (
    <SheetFrame
      title={claimed ? "Phone paired" : "Scan with the FamilyFi app"}
      sub={
        claimed
          ? `${state?.device?.displayName ?? "The phone"} is paired${replacing ? " and its old entry is gone" : ""}. Sign in on the phone to finish.`
          : "Open FamilyFi on the phone and scan the QR, or copy the pairing code and paste it in the app. Then confirm the household it shows."
      }
      onClose={onClose}
      footer={
        claimed ? (
          <button type="button" className={PRIMARY_BUTTON} onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={PRIMARY_BUTTON} disabled={busy} onClick={() => void generate()}>
              New code
            </button>
          </>
        )
      }
    >
      {claimed ? (
        <p data-testid="pairing-claimed" className="rounded-[9px] bg-[var(--ff-on-tint)] px-3 py-2.5 text-[14px] font-semibold text-[var(--ff-on-ink)]">
          Paired {state?.device?.displayName ?? ""} ✓
        </p>
      ) : (
        <>
          <div className="relative mx-auto">
            <QrCode value={issued.pairingCode} label="Pairing QR code" />
            {expired ? (
              <div className="absolute inset-0 flex items-center justify-center bg-[var(--ff-card-veil)] text-[17px] font-bold">Expired</div>
            ) : null}
          </div>
          <p data-testid="pairing-countdown" className="text-center text-[14px] text-[var(--ff-muted)]">
            {expired ? "This code expired. Make a new one." : `Expires in ${countdown(remaining)}`}
          </p>
          <CopyRow label="Pairing code" value={issued.pairingCode} testId="pairing-code" />
        </>
      )}
      {error ? (
        <p role="alert" className="text-[14px] font-semibold text-[var(--ff-danger)]">
          {error}
        </p>
      ) : null}
    </SheetFrame>
  );
}
