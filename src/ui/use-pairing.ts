"use client";

import { useEffect, useRef, useState } from "react";

import { ApiError, type ApiRequest } from "@/lib/api-client";
import { pairingExpired, pairingSheetCopy } from "@/lib/pair-device";
import type { ConnectionRoute, PairedPhone, PairingState } from "@/lib/types";

export type IssuedPairing = { id: string; expiresAt: string; pairingCode: string };

/**
 * A pairing through the published route: name the phone, issue a single-use code, then watch it
 * until a phone claims it or it expires. A code nobody claimed is cancelled when a new one replaces
 * it and when the sheet goes away, so a QR left on screen dies with it.
 */
export function usePairing({
  request,
  route,
  replacing,
  onPaired,
}: {
  request: ApiRequest;
  route: ConnectionRoute;
  replacing?: PairedPhone | null;
  onPaired: () => void;
}) {
  const [name, setName] = useState(replacing?.displayName ?? pairingSheetCopy().defaultName);
  const [issued, setIssued] = useState<IssuedPairing | null>(null);
  const [state, setState] = useState<PairingState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<string | null>(null);

  const expired = pairingExpired(issued, state, now);
  const claimed = state?.status === "claimed";

  useEffect(() => {
    if (!issued || claimed) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [issued, claimed]);

  useEffect(() => {
    if (!issued || claimed || expired) return;
    const poll = setInterval(() => {
      void request<{ pairing: PairingState }>(`/api/v1/connection/pairings/${issued.id}`)
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
  }, [request, issued, claimed, expired, onPaired]);

  useEffect(
    () => () => {
      if (pending.current) void request(`/api/v1/connection/pairings/${pending.current}`, { method: "DELETE" }).catch(() => undefined);
    },
    [request],
  );

  async function generate() {
    setError("");
    setBusy(true);
    try {
      if (pending.current) await request(`/api/v1/connection/pairings/${pending.current}`, { method: "DELETE" }).catch(() => undefined);
      const { pairing } = await request<{ pairing: IssuedPairing }>("/api/v1/connection/pairings", {
        method: "POST",
        body: { endpointId: route.id, deviceName: name.trim(), ...(replacing ? { replacesDeviceId: replacing.id } : {}) },
      });
      pending.current = pairing.id;
      setIssued(pairing);
      setState(null);
      setNow(Date.now());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : pairingSheetCopy().issueFailed);
    } finally {
      setBusy(false);
    }
  }

  const copy = pairingSheetCopy({ replacing, claimed, claimedName: state?.device?.displayName });
  return {
    route,
    name,
    setName,
    issued,
    expired,
    claimed,
    now,
    error,
    busy,
    generate,
    /** The sheet's title and line for the step it is on. */
    heading: issued ? copy.code : copy.name,
    copy,
  };
}

export type Pairing = ReturnType<typeof usePairing>;
