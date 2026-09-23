"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { TRANSPORTS, canPin, nextPriority } from "@/lib/connection-routes";
import type { CertificatePin, ConnectionRoute, ConnectionTransport } from "@/lib/types";
import { Segmented } from "@/components/ui/Segmented";
import { FIELD, PRIMARY_BUTTON, SECONDARY_BUTTON, SheetFrame } from "./SheetFrame";

type Trust = "system" | "pinned";

function defaultUrl(): string {
  if (typeof window === "undefined") return "https://";
  return window.location.protocol === "https:" ? window.location.origin : "https://";
}

function expiry(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Add or edit a route. A pinned route is for a home-network address whose certificate
 * the iPhone would not otherwise trust; FamilyFi reads the pin from the address (or a
 * pasted certificate) so nobody computes it by hand, and the field stays editable as
 * the override.
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
  const [trust, setTrust] = useState<Trust>(route?.trustMode ?? "system");
  const [pin, setPin] = useState(route?.spkiSha256 ?? "");
  const [read, setRead] = useState<CertificatePin | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pem, setPem] = useState("");
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const note = TRANSPORTS.find((item) => item.value === transport)?.note;
  const pinned = trust === "pinned" && canPin(transport);
  const pinDiffers = pinned && read !== null && pin.trim() !== read.spkiSha256;

  async function readPin(body: { url: string } | { certificate: string }) {
    setReadError("");
    setReading(true);
    try {
      const result = await api<{ pin: CertificatePin }>("/api/v1/connection/pins", { method: "POST", body: JSON.stringify(body) });
      setRead(result.pin);
      setPin(result.pin.spkiSha256);
      setPasting(false);
    } catch (caught) {
      setRead(null);
      setReadError(caught instanceof ApiError ? caught.message : "Could not read the certificate.");
    } finally {
      setReading(false);
    }
  }

  async function save() {
    setError("");
    setSaving(true);
    const trustMode: Trust = pinned ? "pinned" : "system";
    const body = { url: url.trim(), transport, trustMode, spkiSha256: pinned ? pin.trim() : null };
    try {
      if (route) {
        await api(`/api/v1/connection/endpoints/${route.id}`, { method: "PUT", body: JSON.stringify(body) });
      } else {
        const { spkiSha256, ...rest } = body;
        await api("/api/v1/connection/endpoints", {
          method: "POST",
          body: JSON.stringify({ ...rest, ...(spkiSha256 ? { spkiSha256 } : {}), priority: nextPriority(routes) }),
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
          <button type="button" className={PRIMARY_BUTTON} disabled={saving || !url.trim() || (pinned && !pin.trim())} onClick={() => void save()}>
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
          onChange={(event) => {
            setUrl(event.target.value);
            setRead(null);
          }}
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

      {canPin(transport) ? (
        <div className="flex flex-col gap-2">
          <div className="text-[14px] font-semibold text-[var(--ff-muted)]">Certificate</div>
          <Segmented
            name="Certificate trust"
            value={trust}
            grow
            onChange={setTrust}
            segments={[
              { value: "system", label: "Trusted by iPhone" },
              { value: "pinned", label: "Pin this certificate" },
            ]}
          />
        </div>
      ) : null}

      {pinned ? (
        <div className="flex flex-col gap-2.5 rounded-[9px] bg-[var(--ff-note-fill)] px-3 py-3">
          <p className="text-[14px] leading-5 text-[var(--ff-muted)]">
            For a self-signed certificate. The phone accepts only this exact key, so a certificate renewed with a new key
            stops phones until you update the pin here.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={SECONDARY_BUTTON} disabled={reading || !url.trim()} onClick={() => void readPin({ url: url.trim() })}>
              {reading ? "Reading…" : "Read certificate from this address"}
            </button>
            <button type="button" className="text-[14px] font-semibold text-[var(--ff-accent)]" onClick={() => setPasting((value) => !value)}>
              {pasting ? "Hide paste box" : "Paste certificate instead"}
            </button>
          </div>
          {pasting ? (
            <div className="flex flex-col gap-2">
              <textarea
                aria-label="Certificate (PEM)"
                className={`${FIELD} mt-0 h-28 font-mono text-[14px]`}
                value={pem}
                onChange={(event) => setPem(event.target.value)}
                placeholder="-----BEGIN CERTIFICATE-----"
                spellCheck={false}
              />
              <button type="button" className={SECONDARY_BUTTON} disabled={reading || !pem.trim()} onClick={() => void readPin({ certificate: pem })}>
                Use this certificate
              </button>
            </div>
          ) : null}
          {readError ? (
            <p role="alert" className="text-[14px] font-semibold text-[var(--ff-danger)]">
              {readError}
            </p>
          ) : null}
          {read ? (
            <p data-testid="certificate-read" className="text-[14px] leading-5">
              {read.subject} · issued by {read.issuer} · expires {expiry(read.validTo)}
            </p>
          ) : null}
          {read?.systemTrusted ? (
            <p className="text-[14px] font-semibold text-[var(--ff-paused)]">
              This certificate is already trusted by devices. Choose Trusted by iPhone instead, so renewals don&rsquo;t break
              the pin.
            </p>
          ) : null}
          <label className="text-[14px] font-semibold text-[var(--ff-muted)]">
            SPKI SHA-256 pin
            <input
              className={`${FIELD} font-mono`}
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="43 characters, base64url"
            />
          </label>
          {pinDiffers ? (
            <p className="text-[14px] font-semibold text-[var(--ff-paused)]">
              This pin differs from the certificate FamilyFi just read. Phones will refuse the route unless the pin matches.
            </p>
          ) : null}
        </div>
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
