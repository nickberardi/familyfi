import type { PairedScope } from "./types";

/** What the adult pastes into an agent: where the guide is, and the single-use code it connects with. */
export function agentPrompt(origin: string, pairingCode: string): string {
  return `Read ${origin}/agents.md and follow it to connect to my FamilyFi. My pairing code is ${pairingCode}`;
}

/** The scopes an adult may give an agent. */
export const AGENT_SCOPES: readonly { value: "agent:full" | "agent:readOnly"; label: string; detail: string }[] = [
  { value: "agent:full", label: "Full access", detail: "Read the household, and change groups, rules, pauses, allowances and device assignment." },
  { value: "agent:readOnly", label: "Read only", detail: "Read groups, rules, devices and sync status. It cannot change anything." },
];

const SCOPE_LABELS: Record<string, string> = { "app:full": "Full access", "agent:full": "Full access", "app:rulesOnly": "Rules only", "agent:readOnly": "Read only", "me:askOnly": "FamilyFi Me" };

/** A scope's name; one this client does not know, from a newer server, is shown as sent. */
export function scopeLabel(scope: PairedScope): string {
  return SCOPE_LABELS[scope] ?? scope;
}
