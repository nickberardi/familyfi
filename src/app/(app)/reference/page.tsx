"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { AgentRow } from "@/components/agents/AgentRow";
import { ConnectAgentSheet } from "@/components/agents/ConnectAgentSheet";
import { PageHeader } from "@/components/PageHeader";
import { api, ApiError } from "@/lib/api";
import type { PairedPhone } from "@/lib/types";

const ApiReference = dynamic(() => import("@/components/ApiReference").then((mod) => mod.ApiReference), {
  ssr: false,
  loading: () => <p className="px-6 py-4 text-[14px] text-[var(--ff-muted)]">Loading API reference…</p>,
});

const CARD = "overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]";
const CARD_HEAD = "flex flex-wrap items-baseline gap-2.5 border-b border-[var(--ff-hairline-card)] px-[18px] py-[15px]";

export default function ApiPage() {
  const [agents, setAgents] = useState<PairedPhone[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async () => {
    try {
      const { devices } = await api<{ devices: PairedPhone[] }>("/api/v1/connection/devices");
      setAgents(devices.filter((device) => device.client === "agent" && !device.revokedAt));
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "administrator_required") setForbidden(true);
      else setError(caught instanceof Error ? caught.message : "Could not load agents.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load();
  }, [load]);

  async function revoke(agent: PairedPhone) {
    if (!window.confirm(`Revoke ${agent.displayName}? It loses access now and needs a new pairing code to come back.`)) return;
    setError("");
    try {
      await api(`/api/v1/connection/devices/${agent.id}`, { method: "DELETE" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn't work.");
    }
    await load();
  }

  return (
    <>
      <PageHeader
        title="API"
        sub="OpenAPI 3.1 reference for the web app, the iPhone app and AI agents. Try it out uses your signed-in session."
        actionLabel={forbidden ? undefined : "Connect an agent"}
        onAction={forbidden ? undefined : () => setConnecting(true)}
      />
      <div className="px-4 pt-4 md:px-6">
        <section className={CARD} aria-label="AI agents">
          <div className={CARD_HEAD}>
            <span className="text-[14px] font-semibold">AI agents</span>
            <span className="text-[14px] text-[var(--ff-muted)]">Let an agent on your home network read or manage the household for you</span>
          </div>
          {error ? (
            <p role="alert" className="px-[18px] pt-3 text-[14px] font-semibold text-[var(--ff-danger)]">
              {error}
            </p>
          ) : null}
          {forbidden ? (
            <p className="px-[18px] py-4 text-[14px] text-[var(--ff-muted)]">Only a household admin can connect agents.</p>
          ) : agents === null ? (
            <p className="px-[18px] py-4 text-[14px] text-[var(--ff-muted)]">Loading agents…</p>
          ) : agents.length === 0 ? (
            <p className="px-[18px] py-4 text-[14px] text-[var(--ff-muted)]">
              No agents yet. Use Connect an agent to get a prompt for Claude Code, Codex or another agent.
            </p>
          ) : (
            agents.map((agent) => <AgentRow key={agent.id} agent={agent} onRevoke={() => void revoke(agent)} />)
          )}
        </section>
      </div>
      <div className="ff-swagger min-w-0 px-2 pb-8 md:px-4">
        <ApiReference />
      </div>
      {connecting ? <ConnectAgentSheet onClose={() => setConnecting(false)} onConnected={load} /> : null}
    </>
  );
}
