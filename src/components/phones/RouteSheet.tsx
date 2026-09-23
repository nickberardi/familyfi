"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { TRANSPORTS, nextPriority } from "@/lib/connection-routes";
import type { ConnectionRoute, ConnectionTransport } from "@/lib/types";
import { FIELD, PRIMARY_BUTTON, SECONDARY_BUTTON, SheetFrame } from "./SheetFrame";

function defaultUrl(): string {
  if (typeof window === "undefined") return "https://";
  return window.location.protocol === "https:" ? window.location.origin : "https://";
}

/**
 * Add or edit a route. Trust is system-only here: pinning a LAN certificate arrives with
 * the pin reader, so an existing pinned route keeps its pin and can only be moved to
 * system trust.
 */
export function RouteSheet({
  route,
  routes,
  onClose,
  onSaved,
}: {
  route: ConnectionRoute | null;
  routes: ConnectionRoute[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [url, setUrl] = useState(route?.url ?? defaultUrl());
  const [transport, setTransport] = useState<ConnectionTransport>(route?.transport ?? "lan");
  const [keepPin, setKeepPin] = useState(route?.trustMode === "pinned");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const note = TRANSPORTS.find((item) => item.value === transport)?.note;

  async function save() {
    setError("");
    setSaving(true);
    try {
      if (route) {
        const body: Record<string, unknown> = { url: url.trim(), transport };
        if (route.trustMode === "pinned" && !keepPin) Object.assign(body, { trustMode: "system", spkiSha256: null });
        await api(`/api/v1/connection/endpoints/${route.id}`, { method: "PUT", body: JSON.stringify(body) });
      } else {
        await api("/api/v1/connection/endpoints", {
          method: "POST",
          body: JSON.stringify({ url: url.trim(), transport, trustMode: "system", priority: nextPriority(routes) }),
        });
      }
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save the route.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SheetFrame
      title={route ? "Edit route" : "Add a route"}
      sub="An HTTPS address the FamilyFi app can use to reach this server."
      onClose={onClose}
      footer={
        <>
          <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={PRIMARY_BUTTON} disabled={saving || !url.trim()} onClick={() => void save()}>
            {route ? "Save" : "Add route"}
          </button>
        </>
      }
    >
      <label className="text-[14px] font-semibold text-[var(--ff-muted)]">
        Address
        <input
          className={`${FIELD} font-mono`}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="https://familyfi.home:8443"
        />
        <span className="mt-1 block font-normal">HTTPS origin only — no path. Phones must type it exactly as saved.</span>
      </label>
      <label className="text-[14px] font-semibold text-[var(--ff-muted)]">
        How the phone gets there
        <select className={FIELD} value={transport} onChange={(event) => setTransport(event.target.value as ConnectionTransport)}>
          {TRANSPORTS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <span className="mt-1 block font-normal">{note}</span>
      </label>
      {route?.trustMode === "pinned" ? (
        <label className="flex items-start gap-2 text-[14px]">
          <input type="checkbox" className="mt-1" checked={keepPin} onChange={(event) => setKeepPin(event.target.checked)} />
          <span>Keep the pinned certificate. Untick to use ordinary certificate checks instead.</span>
        </label>
      ) : (
        <p className="rounded-[9px] bg-[var(--ff-note-fill)] px-3 py-2.5 text-[14px] leading-5 text-[var(--ff-muted)]">
          The phone checks this address&rsquo;s certificate the ordinary way, so it needs a certificate the iPhone already
          trusts.
        </p>
      )}
      {error ? (
        <p role="alert" className="text-[14px] font-semibold text-[var(--ff-danger)]">
          {error}
        </p>
      ) : null}
    </SheetFrame>
  );
}
