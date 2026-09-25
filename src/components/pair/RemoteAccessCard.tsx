"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  HOME_NETWORK_GUIDE,
  OWN_TRANSPORT,
  TAILSCALE_GUIDE,
  remoteChoice,
  savedRoute,
  shortPin,
  transportLabel,
  type RemoteChoice,
} from "@/lib/connection-routes";
import type { AdminRoute, RemoteAccess } from "@/lib/types";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { CloudflareAdvanced } from "./CloudflareAdvanced";
import { PinCheck } from "./PinCheck";
import { RouteForm } from "./RouteForm";
import { FIELD, PRIMARY_BUTTON, SECONDARY_BUTTON } from "./SheetFrame";

type Top = "off" | "quick" | "named";
type Via = "home" | "tailscale" | "cloudflare";
type Cloudflare = "automatic" | "advanced";

const STATUS: Record<RemoteAccess["status"], { label: string; ink: string }> = {
  off: { label: "Off", ink: "var(--ff-muted)" },
  "signing-in": { label: "Waiting for Cloudflare…", ink: "var(--ff-muted)" },
  starting: { label: "Starting…", ink: "var(--ff-muted)" },
  running: { label: "On", ink: "var(--ff-on-ink)" },
  error: { label: "Not connected", ink: "var(--ff-danger)" },
  unavailable: { label: "Unavailable", ink: "var(--ff-danger)" },
};

const LINK = "inline-flex items-center gap-1 font-semibold text-[var(--ff-accent)] underline";

function top(choice: RemoteChoice): Top {
  return choice === "off" || choice === "quick" ? choice : "named";
}

function via(choice: RemoteChoice): Via {
  return choice === "home" || choice === "tailscale" ? choice : "cloudflare";
}

function Guide({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={LINK}>
      {children}
      <Icon name="arrow-square-out" size={14} />
    </a>
  );
}

/**
 * Remote access: the one route phones use to reach home. Off publishes nothing; a quick
 * tunnel needs nothing at all; "My domain" is a permanent address — one you run (home
 * network, Tailscale) or FamilyFi's own Cloudflare tunnel on your domain. Switching
 * publishes that route and turns every other route off, on the server, in one step.
 */
export function RemoteAccessCard({
  tunnel,
  routes,
  pairedThrough,
  onTunnel,
  onChange,
}: {
  tunnel: RemoteAccess | null;
  routes: AdminRoute[] | null;
  /** Active phones that paired through a route — the ones a switch away from it would strand. */
  pairedThrough: (routeId: string) => number;
  onTunnel: (tunnel: RemoteAccess) => void;
  /** Reloads the tunnel state and the routes after a change. */
  onChange: () => Promise<void>;
}) {
  const [choice, setChoice] = useState<RemoteChoice>("off");
  const [editing, setEditing] = useState(false);
  const [hostname, setHostname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [seen, setSeen] = useState<string | null>(null);

  const published = routes?.find((route) => route.id === tunnel?.endpointId) ?? null;
  const publishedChoice = tunnel && routes ? remoteChoice(tunnel, routes) : "off";

  // Keep the picker in step with what the server publishes, once both answers are in.
  const stamp = tunnel && routes ? `${tunnel.mode}|${tunnel.status}|${tunnel.endpointId}|${tunnel.hostname}|${published?.kind}|${published?.transport}` : null;
  if (stamp && stamp !== seen) {
    setSeen(stamp);
    setChoice(publishedChoice);
    setEditing(false);
    if (!hostname && tunnel?.hostname) setHostname(tunnel.hostname);
  }

  /** Switching away from a route phones paired through asks first. */
  function leaving(next: string | null): boolean {
    if (!published || published.id === next) return true;
    const count = pairedThrough(published.id);
    if (!count) return true;
    return window.confirm(
      `${count} phone${count === 1 ? "" : "s"} paired through ${published.url}. They pick up the new address the next time they reach FamilyFi, and can't use this one once you switch.`,
    );
  }

  async function put(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ tunnel: RemoteAccess }>("/api/v1/connection/tunnel", { method: "PUT", body: JSON.stringify(body) });
      onTunnel(result.tunnel);
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not change remote access.");
    } finally {
      setBusy(false);
      await onChange();
    }
  }

  function pickTop(next: Top) {
    setError("");
    if (next === "off") {
      if (leaving(null)) void put({ mode: "off" });
      return;
    }
    if (next === "quick") {
      if (leaving(routes?.find((route) => route.kind === "quick")?.id ?? null)) void put({ mode: "quick" });
      return;
    }
    // "My domain" only opens the choices: nothing is published until one is used.
    if (top(choice) === "named") return;
    const firstSaved = (["home", "tailscale", "cloudflareAutomatic"] as const).find((item) => savedRoute(item, routes ?? []));
    setChoice(firstSaved ?? "home");
    setEditing(false);
  }

  function publishRoute(route: AdminRoute) {
    if (!leaving(route.id)) return Promise.resolve();
    return put({ mode: "named", endpointId: route.id });
  }

  const noBinary = tunnel !== null && !tunnel.cloudflared;
  const status = STATUS[tunnel?.status ?? "off"];
  const settingUp = tunnel?.status === "signing-in";
  const domainReady = Boolean(tunnel?.hostname) && hostname.trim().toLowerCase() === tunnel?.hostname;
  const isPublished = choice === publishedChoice && publishedChoice !== "off";
  const ownTransport = OWN_TRANSPORT[choice];
  const saved = ownTransport && choice !== "cloudflareAdvanced" ? savedRoute(choice, routes ?? []) : undefined;
  const loading = !tunnel || !routes;
  const tunnelChoice = choice === "quick" || choice === "cloudflareAutomatic";

  return (
    <section data-testid="remote-access" className="overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--ff-hairline-card)] px-[18px] py-[15px]">
        <div className="min-w-[200px] flex-1">
          <div className="text-[14px] font-semibold">Remote access</div>
          <div className="mt-0.5 text-[14px] text-[var(--ff-muted)]">Choose how the FamilyFi app reaches home. Phones use this one address.</div>
        </div>
        {tunnel && tunnel.status !== "off" ? (
          <span data-testid="remote-status" className="text-[14px] font-semibold" style={{ color: status.ink }}>
            {status.label}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-3 px-[18px] py-3 text-[14px] leading-5">
        <Segmented
          name="Remote access"
          value={top(choice)}
          grow
          onChange={pickTop}
          // Nothing is pickable until the server has said what is on, or its answer would undo the pick.
          segments={[
            { value: "off", label: "Off", disabled: busy || loading },
            { value: "quick", label: "Quick tunnel", disabled: busy || loading || noBinary },
            { value: "named", label: "My domain", disabled: busy || loading },
          ]}
        />

        {choice === "off" ? <p className="text-[var(--ff-muted)]">No route is published, so phones can&rsquo;t reach home or pair.</p> : null}

        {choice === "quick" ? (
          <p className="text-[var(--ff-muted)]">
            A free Cloudflare quick tunnel: no account needed. Its address changes when FamilyFi restarts, and phones pick up the new
            one next time they&rsquo;re home. Cloudflare offers quick tunnels for trying things out, without an uptime promise.
          </p>
        ) : null}

        {top(choice) === "named" ? (
          <>
            <div className="flex flex-col gap-2">
              <div className="font-semibold text-[var(--ff-muted)]">How phones reach home</div>
              <Segmented
                name="How phones reach home"
                value={via(choice)}
                grow
                onChange={(next) => {
                  setError("");
                  setEditing(false);
                  setChoice(next === "cloudflare" ? "cloudflareAutomatic" : next);
                }}
                segments={[
                  { value: "home", label: "Home network", disabled: busy || settingUp },
                  { value: "tailscale", label: "Tailscale", disabled: busy || settingUp },
                  { value: "cloudflare", label: "Cloudflare Tunnel", disabled: busy || settingUp },
                ]}
              />
            </div>

            {choice === "home" ? (
              <p className="text-[var(--ff-muted)]">
                An address on your home network — reached directly on Wi-Fi, over your VPN, or through your reverse proxy.{" "}
                <Guide href={HOME_NETWORK_GUIDE}>Set up a VPN or reverse proxy</Guide>
              </p>
            ) : null}
            {choice === "tailscale" ? (
              <p className="text-[var(--ff-muted)]">
                A <span className="font-mono">https://…ts.net</span> address from Tailscale Serve. The phone needs the Tailscale app in the
                same tailnet. Use Serve, never Funnel. <Guide href={TAILSCALE_GUIDE}>Set up the Tailscale sidecar</Guide>
              </p>
            ) : null}

            {ownTransport && choice !== "cloudflareAdvanced" ? (
              editing || !saved ? (
                <RouteForm
                  key={`${choice}-${saved?.id ?? "new"}`}
                  transport={ownTransport}
                  route={editing ? saved : undefined}
                  routes={routes ?? []}
                  onSaved={publishRoute}
                  onCancel={saved ? () => setEditing(false) : undefined}
                />
              ) : (
                <div data-testid="saved-route" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[9px] border border-[var(--ff-hairline)] px-3 py-2.5">
                  <div className="min-w-[200px] flex-1">
                    <div className="font-mono break-all">{saved.url}</div>
                    <div className="mt-0.5 text-[var(--ff-muted)]">
                      {saved.trustMode === "pinned" && saved.spkiSha256 ? (
                        <>
                          Pinned <span className="font-mono">{shortPin(saved.spkiSha256)}</span>
                        </>
                      ) : (
                        "Ordinary certificate checks"
                      )}
                    </div>
                  </div>
                  {isPublished ? null : (
                    <button type="button" className={PRIMARY_BUTTON} disabled={busy} onClick={() => void publishRoute(saved)}>
                      Use this route
                    </button>
                  )}
                  <button type="button" className="font-semibold text-[var(--ff-accent)]" disabled={busy} onClick={() => setEditing(true)}>
                    Edit
                  </button>
                  {saved.trustMode === "pinned" && saved.spkiSha256 ? <PinCheck route={saved} /> : null}
                </div>
              )
            ) : null}

            {via(choice) === "cloudflare" ? (
              <Segmented
                name="Cloudflare setup"
                value={choice === "cloudflareAdvanced" ? "advanced" : ("automatic" as Cloudflare)}
                grow
                onChange={(next: Cloudflare) => {
                  setError("");
                  setChoice(next === "advanced" ? "cloudflareAdvanced" : "cloudflareAutomatic");
                }}
                segments={[
                  { value: "automatic", label: "Automatic", disabled: busy || settingUp || noBinary },
                  { value: "advanced", label: "Advanced", disabled: busy || settingUp },
                ]}
              />
            ) : null}

            {choice === "cloudflareAdvanced" ? <CloudflareAdvanced /> : null}

            {choice === "cloudflareAutomatic" ? (
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
                  ) : domainReady && isPublished ? null : (
                    <button
                      type="button"
                      className={PRIMARY_BUTTON}
                      disabled={busy || noBinary || !hostname.trim()}
                      onClick={() => {
                        const domain = routes?.find((route) => route.kind === "domain");
                        if (leaving(domainReady ? (domain?.id ?? null) : null)) void put({ mode: "named", hostname: hostname.trim() });
                      }}
                    >
                      {domainReady ? "Turn on" : "Connect with Cloudflare"}
                    </button>
                  )}
                  {tunnel?.hostname && !settingUp ? (
                    <button
                      type="button"
                      className="text-[14px] font-semibold text-[var(--ff-danger)]"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`Forget ${tunnel.hostname}? FamilyFi deletes its tunnel key and turns remote access off. The tunnel and DNS record stay in your Cloudflare account until you remove them there.`)) return;
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
                    {tunnel?.loginUrl ? (
                      <>
                        <a href={tunnel.loginUrl} target="_blank" rel="noreferrer" className="font-semibold text-[var(--ff-accent)] underline">
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
          </>
        ) : null}

        {tunnel?.url && published ? (
          <div data-testid="published-route">
            Phones reach home at <span data-testid="remote-url" className="font-mono break-all">{tunnel.url}</span>
            <span className="text-[var(--ff-muted)]">
              {" "}
              · {published.kind === "own" ? transportLabel(published.transport) : published.kind === "quick" ? "Quick tunnel" : "Cloudflare Tunnel"}
              {pairedThrough(published.id) ? ` · ${pairedThrough(published.id)} phone${pairedThrough(published.id) === 1 ? "" : "s"} paired here` : ""}
            </span>
          </div>
        ) : null}
        {tunnel?.error ? <div className="font-semibold text-[var(--ff-danger)]">{tunnel.error}</div> : null}
        {error ? (
          <div role="alert" className="font-semibold text-[var(--ff-danger)]">
            {error}
          </div>
        ) : null}
        {noBinary && tunnelChoice ? (
          <div className="text-[var(--ff-muted)]">
            This server doesn&rsquo;t have cloudflared. The FamilyFi Docker image includes it; for development, install it with Homebrew.
          </div>
        ) : null}
        {tunnelChoice ? (
          <p className="text-[var(--ff-muted)]">
            Only the app&rsquo;s own requests go through the tunnel — this web page and its sign-in stay on your home network, and signing
            in from outside needs a paired phone.
          </p>
        ) : null}
      </div>
    </section>
  );
}
