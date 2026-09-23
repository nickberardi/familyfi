"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { RemoteAccess } from "@/lib/types";
import { Segmented } from "@/components/ui/Segmented";
import { FIELD, PRIMARY_BUTTON, SECONDARY_BUTTON } from "./SheetFrame";

type Choice = "off" | "quick" | "named";

const STATUS: Record<RemoteAccess["status"], { label: string; ink: string }> = {
  off: { label: "Off", ink: "var(--ff-muted)" },
  "signing-in": { label: "Waiting for Cloudflare…", ink: "var(--ff-muted)" },
  starting: { label: "Starting…", ink: "var(--ff-muted)" },
  running: { label: "On", ink: "var(--ff-on-ink)" },
  error: { label: "Not connected", ink: "var(--ff-danger)" },
  unavailable: { label: "Unavailable", ink: "var(--ff-danger)" },
};

/**
 * The easy buttons. A quick tunnel needs nothing at all; "my domain" needs one
 * Cloudflare authorization and then keeps a permanent address. Either way the tunnel
 * reaches only the phone-only gateway — the web app itself never goes through it.
 */
/** `onRouteChange` must be stable (useCallback): it runs whenever the tunnel's state changes. */
export function RemoteAccessCard({ onRouteChange }: { onRouteChange: (managedRouteId: string | null) => void }) {
  const [state, setState] = useState<RemoteAccess | null>(null);
  const [choice, setChoice] = useState<Choice>("off");
  const [hostname, setHostname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [seen, setSeen] = useState<string | null>(null);

  const waiting = state?.status === "signing-in" || state?.status === "starting";
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const { tunnel } = await api<{ tunnel: RemoteAccess }>("/api/v1/connection/tunnel");
        if (!cancelled) setState(tunnel);
      } catch {
        // The page shows its own load errors; the card just stays as it was.
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), waiting ? 2000 : 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [waiting]);

  // Keep the picker in step with what the server reports.
  const stamp = state ? `${state.mode}|${state.status}|${state.endpointId}|${state.url}|${state.hostname}` : null;
  if (state && stamp !== seen) {
    setSeen(stamp);
    setChoice(state.status === "signing-in" ? "named" : state.mode);
    if (!hostname && state.hostname) setHostname(state.hostname);
  }

  // The routes list belongs to the page, so tell it after render, never during.
  const managedRouteId = state?.endpointId ?? null;
  useEffect(() => {
    if (stamp) onRouteChange(managedRouteId);
  }, [stamp, managedRouteId, onRouteChange]);

  async function put(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const { tunnel } = await api<{ tunnel: RemoteAccess }>("/api/v1/connection/tunnel", { method: "PUT", body: JSON.stringify(body) });
      setState(tunnel);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not change remote access.");
    } finally {
      setBusy(false);
    }
  }

  function pick(next: Choice) {
    setChoice(next);
    setError("");
    if (next === "off") void put({ mode: "off" });
    if (next === "quick") void put({ mode: "quick" });
    // "named" waits for a hostname, unless one is already set up.
    if (next === "named" && state?.hostname) void put({ mode: "named" });
  }

  const noBinary = state !== null && !state.cloudflared;
  const status = STATUS[state?.status ?? "off"];
  const settingUp = state?.status === "signing-in";
  const domainReady = Boolean(state?.hostname) && hostname.trim().toLowerCase() === state?.hostname;

  return (
    <section data-testid="remote-access" className="overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--ff-hairline-card)] px-[18px] py-[15px]">
        <div className="min-w-[200px] flex-1">
          <div className="text-[14px] font-semibold">Remote access</div>
          <div className="mt-0.5 text-[14px] text-[var(--ff-muted)]">Reach home from the FamilyFi app anywhere, with no router setup.</div>
        </div>
        {state && state.status !== "off" ? (
          <span data-testid="remote-status" className="text-[14px] font-semibold" style={{ color: status.ink }}>
            {status.label}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-3 px-[18px] py-3 text-[14px] leading-5">
        <Segmented
          name="Remote access"
          value={choice}
          grow
          onChange={(next) => pick(next)}
          // Nothing is pickable until the server has said what is on, or its answer would undo the pick.
          segments={[
            { value: "off", label: "Off", disabled: busy || !state },
            { value: "quick", label: "Quick tunnel", disabled: busy || !state || noBinary },
            { value: "named", label: "My domain", disabled: busy || !state || noBinary },
          ]}
        />

        {choice === "quick" ? (
          <p className="text-[var(--ff-muted)]">
            A free Cloudflare quick tunnel: no account needed. Its address changes when FamilyFi restarts, and phones pick up the new
            one next time they&rsquo;re home. Cloudflare offers quick tunnels for trying things out, without an uptime promise.
          </p>
        ) : null}

        {choice === "named" ? (
          <div className="flex flex-col gap-2">
            <p className="text-[var(--ff-muted)]">
              A permanent address on a domain in your Cloudflare account. FamilyFi asks Cloudflare once for permission, creates the
              tunnel and its DNS record, then keeps only that tunnel&rsquo;s key, encrypted. The Cloudflare sign-in itself is thrown
              away straight after.
            </p>
            <label className="font-semibold text-[var(--ff-muted)]">
              Hostname
              <input
                className={`${FIELD} font-mono`}
                value={hostname}
                onChange={(event) => setHostname(event.target.value)}
                placeholder="familyfi.example.com"
                autoComplete="off"
                spellCheck={false}
                disabled={settingUp}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {settingUp ? (
                <button type="button" className={SECONDARY_BUTTON} disabled={busy} onClick={() => void put({ mode: "off" })}>
                  Cancel
                </button>
              ) : domainReady && state?.mode === "named" ? null : (
                <button
                  type="button"
                  className={PRIMARY_BUTTON}
                  disabled={busy || noBinary || !hostname.trim()}
                  onClick={() => void put({ mode: "named", hostname: hostname.trim() })}
                >
                  {domainReady ? "Turn on" : "Connect with Cloudflare"}
                </button>
              )}
              {state?.hostname && !settingUp ? (
                <button
                  type="button"
                  className="text-[14px] font-semibold text-[var(--ff-danger)]"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Forget ${state.hostname}? FamilyFi deletes its tunnel key. The tunnel and DNS record stay in your Cloudflare account until you remove them there.`)) return;
                    setHostname("");
                    void put({ mode: "off", forget: true });
                  }}
                >
                  Forget domain
                </button>
              ) : null}
            </div>
            {settingUp ? (
              <div data-testid="remote-login" className="rounded-[9px] bg-[var(--ff-note-fill)] px-3 py-2.5">
                {state?.loginUrl ? (
                  <>
                    <a href={state.loginUrl} target="_blank" rel="noreferrer" className="font-semibold text-[var(--ff-accent)] underline">
                      Open Cloudflare to authorize FamilyFi
                    </a>
                    <span className="text-[var(--ff-muted)]"> — pick the domain for {hostname.trim()}, then come back. This page updates by itself.</span>
                  </>
                ) : (
                  <span className="text-[var(--ff-muted)]">Asking Cloudflare for a sign-in link…</span>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        {state?.url ? (
          <div>
            Phones reach home at <span data-testid="remote-url" className="font-mono break-all">{state.url}</span>
          </div>
        ) : null}
        {state?.error ? <div className="font-semibold text-[var(--ff-danger)]">{state.error}</div> : null}
        {error ? (
          <div role="alert" className="font-semibold text-[var(--ff-danger)]">
            {error}
          </div>
        ) : null}
        {noBinary ? (
          <div className="text-[var(--ff-muted)]">
            This server doesn&rsquo;t have cloudflared. The FamilyFi Docker image includes it; for development, install it with Homebrew.
          </div>
        ) : null}
        <p className="text-[var(--ff-muted)]">
          Only the app&rsquo;s own requests go through the tunnel — this web page and its sign-in stay on your home network, and signing
          in from outside needs a paired phone.
        </p>
      </div>
    </section>
  );
}
