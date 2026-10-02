"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { PairingState } from "@/lib/types";

export type IssuedPairing = { id: string; expiresAt: string; pairingCode: string };

/**
 * A single-use pairing code on screen: make it, count it down, and poll until something claims it.
 * Making a new code, or leaving, cancels one nobody claimed, so a code left on screen dies with it.
 */
export function usePairingCode({ body, onClaimed }: { body: () => Record<string, unknown>; onClaimed: () => void }) {
  const [issued, setIssued] = useState<IssuedPairing | null>(null);
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
            onClaimed();
          }
        })
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(poll);
  }, [issued, claimed, expired, onClaimed]);

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
      const { pairing } = await api<{ pairing: IssuedPairing }>("/api/v1/connection/pairings", { method: "POST", body: JSON.stringify(body()) });
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

  const remaining = issued ? new Date(issued.expiresAt).getTime() - now : 0;
  return { issued, state, expired, claimed, remaining, error, busy, generate };
}
