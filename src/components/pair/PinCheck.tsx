"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { shortPin } from "@/lib/connection-routes";
import type { CertificatePin, ConnectionRoute } from "@/lib/types";

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

/** A "Check" link for a pinned route and the verdict it comes back with. */
export function PinCheck({ route }: { route: ConnectionRoute }) {
  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  return (
    <>
      <button
        type="button"
        className="text-[14px] font-semibold text-[var(--ff-accent)] disabled:opacity-40"
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
      {check ? (
        <div data-testid="pin-check" role="status" className="w-full text-[14px] font-semibold" style={{ color: CHECK_INK[check.tone] }}>
          {check.text}
        </div>
      ) : null}
    </>
  );
}
