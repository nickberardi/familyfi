"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { homeAddress, homeOrigin, type HomeAccess } from "@/lib/connection-routes";
import type { PairedPhone } from "@/lib/types";
import { AgentRow } from "@/components/agents/AgentRow";
import { ConnectAgentSheet } from "@/components/agents/ConnectAgentSheet";
import { FIELD, PRIMARY_BUTTON, SECONDARY_BUTTON } from "./SheetFrame";

/**
 * Home access: where FamilyFi is on the home network, kept apart from Remote access, the route
 * phones use from outside. It is always on. AI agents pair here, so it must answer without a
 * proxy's sign-in page: with nothing saved, the address this page is open at stands in only when
 * it is a private one, and otherwise the card asks for an address. Agents are connected from here.
 */
export function HomeAccessCard({
  agents,
  onRevoke,
  onConnected,
}: {
  agents: PairedPhone[];
  onRevoke: (agent: PairedPhone) => void;
  /** After an agent claims its code, so the list shows it. */
  onConnected: () => void;
}) {
  const [home, setHome] = useState<HomeAccess | null>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    api<{ home: HomeAccess }>("/api/v1/connection/home")
      .then((result) => setHome(result.home))
      .catch((caught) => setError(caught instanceof ApiError ? caught.message : "Could not load home access."));
  }, []);

  async function save(url: string | null) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ home: HomeAccess }>("/api/v1/connection/home", { method: "PUT", body: JSON.stringify({ url }) });
      setHome(result.home);
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save the home network address.");
    } finally {
      setBusy(false);
    }
  }

  function edit() {
    setValue(home ? (homeAddress(home) ?? "") : "");
    setEditing(true);
  }

  const address = home ? homeAddress(home) : null;
  const trimmed = value.trim();
  const valid = trimmed === "" || homeOrigin(trimmed) !== null;
  const active = agents.filter((agent) => agent.client === "agent" && !agent.revokedAt);

  return (
    <section data-testid="home-access" className="overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--ff-hairline-card)] px-[18px] py-[15px]">
        <div className="min-w-[200px] flex-1">
          <div className="text-[14px] font-semibold">Home access</div>
          <div className="mt-0.5 text-[14px] text-[var(--ff-muted)]">Where FamilyFi is on your home network. AI agents connect here.</div>
        </div>
        <span className="text-[14px] font-semibold text-[var(--ff-on-ink)]">Always on</span>
      </div>
      <div className="flex flex-col gap-3 px-[18px] py-3 text-[14px] leading-5">
        {home === null ? (
          error ? null : <p className="text-[var(--ff-muted)]">Loading…</p>
        ) : editing ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void save(trimmed === "" ? null : trimmed);
            }}
          >
            <label className="font-semibold text-[var(--ff-muted)]">
              Home network address
              <input
                className={`${FIELD} font-mono`}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="http://192.168.1.10:7001"
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
              />
            </label>
            <p className="text-[var(--ff-muted)]">
              {valid ? "An IP address and port, or a name such as familyfi.local. Leave it empty to use the address you open FamilyFi at." : "Use an http or https address with no path."}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className={PRIMARY_BUTTON} disabled={busy || !valid}>
                Save
              </button>
              <button type="button" className={SECONDARY_BUTTON} disabled={busy} onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : address ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[9px] border border-[var(--ff-hairline)] px-3 py-2.5">
            <div className="min-w-[200px] flex-1">
              <div data-testid="home-url" className="font-mono break-all">
                {address}
              </div>
              <div className="mt-0.5 text-[var(--ff-muted)]">{home.url ? "Saved home network address" : "The address you opened FamilyFi at"}</div>
            </div>
            <button type="button" className="font-semibold text-[var(--ff-accent)]" onClick={edit}>
              Edit
            </button>
          </div>
        ) : (
          <div data-testid="home-warning" role="status" className="flex flex-col gap-2 rounded-[9px] bg-[var(--ff-note-fill)] px-3 py-2.5">
            <p>
              <span className="font-semibold">Set your home network address.</span> This page is open at{" "}
              <span className="font-mono break-all">{home.current.url}</span>, which isn&rsquo;t on your home network. An agent may not get
              through it, for example behind a sign-in such as Cloudflare Access.
            </p>
            <div>
              <button type="button" className={PRIMARY_BUTTON} onClick={edit}>
                Set address
              </button>
            </div>
          </div>
        )}
        {error ? (
          <p role="alert" className="font-semibold text-[var(--ff-danger)]">
            {error}
          </p>
        ) : null}
      </div>
      <div className="border-t border-[var(--ff-hairline-card)]">
        <div className="flex items-center justify-between gap-3 px-[18px] pt-3">
          <span className="text-[14px] font-semibold">AI agents</span>
          <button type="button" className={SECONDARY_BUTTON} onClick={() => setConnecting(true)}>
            Connect an agent
          </button>
        </div>
        {active.length ? (
          active.map((agent) => <AgentRow key={agent.id} agent={agent} onRevoke={() => onRevoke(agent)} />)
        ) : (
          <p className="px-[18px] py-3 text-[14px] text-[var(--ff-muted)]">
            No agents yet. Use Connect an agent to get a prompt for Claude Code, Codex or another agent.
          </p>
        )}
      </div>
      {connecting ? <ConnectAgentSheet onClose={() => setConnecting(false)} onConnected={onConnected} /> : null}
    </section>
  );
}
