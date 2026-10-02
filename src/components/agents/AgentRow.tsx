"use client";

import { scopeLabel } from "@/lib/agent-prompt";
import { relativeSweep } from "@/lib/sync-copy";
import type { PairedPhone } from "@/lib/types";
import { Icon } from "@/components/ui/Icon";

/**
 * A connected agent: what it may do, whose account it acts as, and when it was last heard from. An
 * agent with no live sign-in let its refresh token lapse (90 days unused) or had it ended; it can
 * only come back with a new pairing code.
 */
export function AgentRow({ agent, onRevoke }: { agent: PairedPhone; onRevoke: () => void }) {
  const seen = agent.lastSeenAt ? relativeSweep(agent.lastSeenAt) : "never";
  const actsAs = agent.sessions[0]?.username;
  const expired = agent.sessions.length === 0;
  return (
    <div data-testid="agent-row" className="flex flex-wrap items-center gap-3 border-t border-[var(--ff-hairline)] px-[18px] py-3 first:border-t-0">
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[var(--ff-field)]">
        <Icon name="robot" size={18} />
      </span>
      <div className="min-w-[200px] flex-1">
        <div className="text-[14px] font-semibold">{agent.displayName}</div>
        <div className="mt-0.5 text-[14px] text-[var(--ff-muted)]">
          {scopeLabel(agent.scope)}
          {actsAs ? ` · acts as ${actsAs}` : ""} · last seen {seen === "now" || seen === "never" ? seen : `${seen} ago`}
        </div>
        {expired ? (
          <div data-testid="agent-expired" className="mt-0.5 text-[14px] font-semibold text-[var(--ff-danger)]">
            Expired. Revoke it and connect again.
          </div>
        ) : null}
      </div>
      <button type="button" className="text-[14px] font-semibold text-[var(--ff-danger)]" onClick={onRevoke}>
        Revoke
      </button>
    </div>
  );
}
