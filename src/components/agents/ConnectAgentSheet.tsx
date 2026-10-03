"use client";

import { useState } from "react";
import { AGENT_SCOPES, agentPrompt } from "@/lib/agent-prompt";
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
          <CopyRow label="Prompt" value={agentPrompt(window.location.origin, issued.code)} testId="agent-prompt" />
          <p data-testid="agent-countdown" className="text-[14px] text-[var(--ff-muted)]">
            {expired ? "This code expired. Make a new one." : `The code works once and expires in ${countdown(remaining)}.`}
          </p>
        </>
      )}
      {errorLine}
    </SheetFrame>
  );
}
