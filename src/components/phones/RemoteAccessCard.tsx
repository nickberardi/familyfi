"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { RemoteAccess } from "@/lib/types";
import { TogglePill } from "@/components/ui/Controls";

const STATUS: Record<RemoteAccess["status"], { label: string; ink: string }> = {
  off: { label: "Off", ink: "var(--ff-muted)" },
  starting: { label: "Starting…", ink: "var(--ff-muted)" },
  running: { label: "On", ink: "var(--ff-on-ink)" },
  error: { label: "Not connected", ink: "var(--ff-danger)" },
  unavailable: { label: "Unavailable", ink: "var(--ff-danger)" },
};

/**
 * The easy button: one switch that opens a Cloudflare quick tunnel to the phone-only
 * gateway and keeps a route pointed at it. The web app itself never goes through it.
 */
export function RemoteAccessCard({ onRouteChange }: { onRouteChange: (managedRouteId: string | null) => void }) {
  const [state, setState] = useState<RemoteAccess | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [seen, setSeen] = useState<string | null>(null);

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
    const timer = setInterval(() => void poll(), state?.status === "starting" ? 2000 : 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [state?.status]);

  // A new address, or a new managed route, changes the routes list below.
  const stamp = state ? `${state.endpointId}|${state.url}|${state.mode}` : null;
  if (state && stamp !== seen) {
    setSeen(stamp);
    onRouteChange(state.endpointId);
  }

  async function set(mode: "off" | "quick") {
    setBusy(true);
    setError("");
    try {
      const { tunnel } = await api<{ tunnel: RemoteAccess }>("/api/v1/connection/tunnel", { method: "PUT", body: JSON.stringify({ mode }) });
      setState(tunnel);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not change remote access.");
    } finally {
      setBusy(false);
    }
  }

  const on = state ? state.mode !== "off" : false;
  const status = STATUS[state?.status ?? "off"];
  return (
    <section data-testid="remote-access" className="overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--ff-hairline-card)] px-[18px] py-[15px]">
        <div className="min-w-[200px] flex-1">
          <div className="text-[14px] font-semibold">Remote access</div>
          <div className="mt-0.5 text-[14px] text-[var(--ff-muted)]">Reach home from the FamilyFi app anywhere, with no router or DNS setup.</div>
        </div>
        {/* The switch names on and off itself; the label only speaks up for the states between. */}
        {state && state.status !== "off" && state.status !== "running" ? (
          <span data-testid="remote-status" className="text-[14px] font-semibold" style={{ color: status.ink }}>
            {status.label}
          </span>
        ) : null}
        <TogglePill
          on={on}
          label="Remote access"
          disabled={busy || !state || (!on && !state.cloudflared)}
          onToggle={() => void set(on ? "off" : "quick")}
        />
      </div>
      <div className="flex flex-col gap-2 px-[18px] py-3 text-[14px] leading-5">
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
        {state && !state.cloudflared ? (
          <div className="text-[var(--ff-muted)]">
            This server doesn&rsquo;t have cloudflared. The FamilyFi Docker image includes it; for development, install it with Homebrew.
          </div>
        ) : null}
        <p className="text-[var(--ff-muted)]">
          Uses a free Cloudflare quick tunnel. Only the app&rsquo;s own requests go through it — this web page and its sign-in stay on
          your home network, and signing in from outside needs a paired phone. The address changes when FamilyFi restarts; phones
          pick up the new one next time they&rsquo;re home. Cloudflare offers quick tunnels for trying things out, without an uptime
          promise.
        </p>
      </div>
    </section>
  );
}
