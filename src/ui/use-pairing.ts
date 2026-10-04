"use client";

import { useEffect, useRef, useState } from "react";

import { ApiError, type ApiRequest } from "@/lib/api-client";
import { defaultPairingAccount, pairingAccounts, pairingExpired, pairingSheetCopy } from "@/lib/pair-device";
import type { Account, ConnectionRoute, PairedPhone, PairingState } from "@/lib/types";

export type IssuedPairing = { id: string; expiresAt: string; code: string };

/**
 * A pairing through the published route: name the phone, choose the administrator it signs in as
 * (pairing is the sign-in), issue a single-use invite code, then watch it until a phone claims it
 * or it expires. A code nobody claimed is cancelled when a new one replaces it and when the sheet
 * goes away, so a QR left on screen dies with it.
 */
export function usePairing({
  request,
  route,
  replacing,
  username,
  onPaired,
}: {
  request: ApiRequest;
  route: ConnectionRoute;
  replacing?: PairedPhone | null;
  /** Who is signed in here: a new phone signs in as them by default. */
  username: string | null;
  onPaired: () => void;
}) {
  const [name, setName] = useState(replacing?.displayName ?? pairingSheetCopy().defaultName);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [issued, setIssued] = useState<IssuedPairing | null>(null);
  const [state, setState] = useState<PairingState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<string | null>(null);

  const expired = pairingExpired(issued, state, now);
  const claimed = state?.status === "claimed";

  // The administrators a phone may sign in as; the one signed in here is chosen once they arrive.
  useEffect(() => {
    let live = true;
    void request<{ accounts: Account[] }>("/api/v1/accounts")
      .then(({ accounts: all }) => {
        if (!live) return;
        setAccounts(pairingAccounts(all));
        setAccountId((current) => current || defaultPairingAccount(all, username));
      })
      // Without them the code cannot be shown, so say why.
      .catch((caught: unknown) => {
        if (live) setError(caught instanceof ApiError ? caught.message : pairingSheetCopy().accountsFailed);
      });
    return () => {
      live = false;
    };
  }, [request, username]);

  useEffect(() => {
    if (!issued || claimed) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [issued, claimed]);

  useEffect(() => {
    if (!issued || claimed || expired) return;
    const poll = setInterval(() => {
      void request<{ invite: PairingState }>(`/api/v1/paired/invites/${encodeURIComponent(issued.id)}`)
        .then(({ invite }) => {
          setState(invite);
          if (invite.status === "claimed") {
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
      if (pending.current) void request(`/api/v1/paired/invites/${encodeURIComponent(pending.current)}`, { method: "DELETE" }).catch(() => undefined);
    },
    [request],
  );

  async function generate() {
    setError("");
    setBusy(true);
    try {
      if (pending.current) await request(`/api/v1/paired/invites/${encodeURIComponent(pending.current)}`, { method: "DELETE" }).catch(() => undefined);
      const { invite } = await request<{ invite: IssuedPairing }>("/api/v1/paired/invites", {
        method: "POST",
        body: { client: "phone", endpointId: route.id, displayName: name.trim(), accountId, ...(replacing ? { replacesDeviceId: replacing.id } : {}) },
      });
      pending.current = invite.id;
      setIssued(invite);
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
    accounts,
    accountId,
    setAccountId,
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
