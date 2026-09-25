"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { countdown, manualPairingCode, transportLabel } from "@/lib/connection-routes";
import type { ConnectionRoute, PairedPhone, PairingQr, PairingState } from "@/lib/types";
import { Icon } from "@/components/ui/Icon";
import { QrCode } from "@/components/ui/QrCode";
import { FIELD, PRIMARY_BUTTON, SECONDARY_BUTTON, SheetFrame } from "./SheetFrame";

type Issued = { id: string; expiresAt: string; qr: PairingQr };

function CopyRow({ label, value, testId }: { label: string; value: string; testId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="text-[14px] font-semibold text-[var(--ff-muted)]">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <code data-testid={testId} className="min-w-0 flex-1 rounded-lg bg-[var(--ff-field)] px-3 py-2 font-mono text-[14px] break-all">
          {value}
        </code>
        <button
          type="button"
          aria-label={`Copy ${label.toLowerCase()}`}
          className="flex flex-none items-center gap-1.5 rounded-lg border border-[var(--ff-line)] px-2.5 py-2 text-[14px] font-semibold text-[var(--ff-accent)]"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          <Icon name="copy" size={16} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/**
 * Pair a phone through the published route: name the phone, then show the single-use QR. The QR is
 * `JSON.stringify(qr)` — the exact bytes the app parses. Closing the sheet or
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
  const [issued, setIssued] = useState<Issued | null>(null);
  const [state, setState] = useState<PairingState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<string | null>(null);

  const expired = issued ? new Date(issued.expiresAt).getTime() <= now || state?.status === "expired" : false;
  const claimed = state?.status === "claimed";

  useEffect(() => {
    if (!issued || claimed) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [issued, claimed]);

  useEffect(() => {
    if (!issued || claimed || expired) return;
    const poll = setInterval(() => {
      void api<{ pairing: PairingState }>(`/api/v1/connection/pairings/${issued.id}`)
        .then(({ pairing }) => {
          setState(pairing);
          if (pairing.status === "claimed") {
            pending.current = null;
            onPaired();
          }
        })
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(poll);
  }, [issued, claimed, expired, onPaired]);

  useEffect(
    () => () => {
      if (pending.current) void api(`/api/v1/connection/pairings/${pending.current}`, { method: "DELETE" }).catch(() => undefined);
    },
    [],
  );

  async function generate() {
    setError("");
    setBusy(true);
    try {
      if (pending.current) await api(`/api/v1/connection/pairings/${pending.current}`, { method: "DELETE" }).catch(() => undefined);
      const { pairing } = await api<{ pairing: Issued }>("/api/v1/connection/pairings", {
        method: "POST",
        body: JSON.stringify({ endpointId: route.id, deviceName: name.trim(), ...(replacing ? { replacesDeviceId: replacing.id } : {}) }),
      });
      pending.current = pairing.id;
      setIssued(pairing);
      setState(null);
      setNow(Date.now());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not create a pairing code.");
    } finally {
      setBusy(false);
    }
  }

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

  const pinned = issued.qr.endpoint.trustMode === "pinned";
  // A typed code carries neither a certificate pin nor a Cloudflare Access token.
  const payloadOnly = pinned || Boolean(issued.qr.edgeCredential);
  return (
    <SheetFrame
      title={claimed ? "Phone paired" : "Scan with the FamilyFi app"}
      sub={
        claimed
          ? `${state?.device?.displayName ?? "The phone"} is paired${replacing ? " and its old entry is gone" : ""}. Sign in on the phone to finish.`
          : "Open FamilyFi on the phone, choose Scan pairing QR, and confirm the household it shows."
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
            <QrCode value={JSON.stringify(issued.qr)} label="Pairing QR code" />
            {expired ? (
              <div className="absolute inset-0 flex items-center justify-center bg-[var(--ff-card-veil)] text-[17px] font-bold">Expired</div>
            ) : null}
          </div>
          <p data-testid="pairing-countdown" className="text-center text-[14px] text-[var(--ff-muted)]">
            {expired ? "This code expired. Make a new one." : `Expires in ${countdown(new Date(issued.expiresAt).getTime() - now)}`}
          </p>
          <CopyRow label="Server address in the app" value={issued.qr.endpoint.url} testId="pairing-address" />
          {payloadOnly ? (
            <>
              <CopyRow label="Pairing payload" value={JSON.stringify(issued.qr)} testId="pairing-payload" />
              <p className="text-[14px] leading-5 text-[var(--ff-muted)]">
                {pinned ? "This route pins a certificate" : "This route is behind Cloudflare Access, whose token"}, which a typed code can&rsquo;t
                carry. Scan the QR, or paste the whole payload.
              </p>
            </>
          ) : (
            <CopyRow label="Code to type instead" value={manualPairingCode(issued.qr)} testId="pairing-code" />
          )}
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
