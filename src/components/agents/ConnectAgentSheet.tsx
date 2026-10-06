"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AGENT_SCOPES, agentPrompt } from "@/lib/agent-prompt";
import { api } from "@/lib/api";
import { homeAddress, type HomeAccess } from "@/lib/connection-routes";
import { countdown } from "@/lib/connection-routes";
import { CopyRow } from "@/components/ui/CopyRow";
import { Segmented } from "@/components/ui/Segmented";
import { usePairingCode } from "@/components/pair/pairing-code-session";
import { FIELD, PRIMARY_BUTTON, SECONDARY_BUTTON, SheetFrame } from "@/components/pair/SheetFrame";

/**
 * Connect an agent: name it and choose its scope, then show the prompt to paste into it. The prompt
 * carries a single-use pairing code; closing the sheet or making a new one cancels a code nobody claimed.
 */
export function ConnectAgentSheet({ onClose, onConnected }: { onClose: () => void; onConnected: () => void }) {
  const [name, setName] = useState("AI agent");
  const [scope, setScope] = useState<"full" | "readOnly">("full");
  const { issued, state, expired, claimed, remaining, error, busy, generate } = usePairingCode({
    body: () => ({ client: "agent", displayName: name.trim(), scope }),
    onClaimed: onConnected,
  });

  // Home access says whether there is an address an agent can reach without a sign-in page.
  const [home, setHome] = useState<HomeAccess | null>(null);
  useEffect(() => {
    api<{ home: HomeAccess }>("/api/v1/connection/home")
      .then((result) => setHome(result.home))
      .catch(() => setHome(null));
  }, []);
  const unsafe = home !== null && homeAddress(home) === null;
  const homeLink = (
    <Link href="/pair" className="font-semibold text-[var(--ff-accent)] underline">
      Home access on Pair Device
    </Link>
  );
  const warning = unsafe ? (
    <p data-testid="agent-home-warning" role="status" className="rounded-[9px] bg-[var(--ff-note-fill)] px-3 py-2.5 text-[14px]">
      <span className="font-semibold">Set your home network address.</span> This page isn&rsquo;t on your home network, so the agent may not get
      through it, for example behind a sign-in such as Cloudflare Access. Set the address under {homeLink}, then make a new code.
    </p>
  ) : null;

  const errorLine = error ? (
    <p role="alert" className="text-[14px] font-semibold text-[var(--ff-danger)]">
      {error}
    </p>
  ) : null;

  if (!issued) {
    return (
      <SheetFrame
        title="Connect an agent"
        sub="Makes a prompt for an AI agent on your home network, such as Claude Code or Codex. The agent gets its own access, which you can revoke here. It never sees your password."
        onClose={onClose}
        footer={
          <>
            <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={PRIMARY_BUTTON} disabled={busy || !name.trim()} onClick={() => void generate()}>
              Show prompt
            </button>
          </>
        }
      >
        <label className="text-[14px] font-semibold text-[var(--ff-muted)]">
          Agent
          <input className={FIELD} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="text-[14px] font-semibold text-[var(--ff-muted)]">
          What it may do
          <div className="mt-1">
            <Segmented name="What the agent may do" value={scope} segments={AGENT_SCOPES} onChange={setScope} grow />
          </div>
          <p className="mt-1.5 font-normal">{AGENT_SCOPES.find((option) => option.value === scope)?.detail}</p>
          <p className="mt-1.5 font-normal">No agent can change accounts, gateway settings, remote access or paired devices.</p>
        </div>
        {warning}
        {errorLine}
      </SheetFrame>
    );
  }

  return (
    <SheetFrame
      title={claimed ? "Agent connected" : "Paste this into your agent"}
      sub={
        claimed
          ? `${state?.device?.displayName ?? "The agent"} is connected. It acts as you, within its scope.`
          : "The agent reads the guide, then connects with the code. This sheet updates when it does."
      }
      onClose={onClose}
      footer={
        claimed ? (
          <button type="button" className={PRIMARY_BUTTON} onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={PRIMARY_BUTTON} disabled={busy} onClick={() => void generate()}>
              New code
            </button>
          </>
        )
      }
    >
      {claimed ? (
        <p data-testid="agent-connected" className="rounded-[9px] bg-[var(--ff-on-tint)] px-3 py-2.5 text-[14px] font-semibold text-[var(--ff-on-ink)]">
          Connected {state?.device?.displayName ?? ""} ✓
        </p>
      ) : (
        <>
          <CopyRow label="Prompt" value={agentPrompt(issued.url ?? window.location.origin, issued.code)} testId="agent-prompt" />
          <p data-testid="agent-address" className="text-[14px] text-[var(--ff-muted)]">
            The agent connects at <span className="font-mono break-all">{issued.url ?? window.location.origin}</span>. Change it under {homeLink}.
          </p>
          {warning}
          <p data-testid="agent-countdown" className="text-[14px] text-[var(--ff-muted)]">
            {expired ? "This code expired. Make a new one." : `The code works once and expires in ${countdown(remaining)}.`}
          </p>
        </>
      )}
      {errorLine}
    </SheetFrame>
  );
}
