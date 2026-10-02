import type { AgentGrant } from "./types";

/** What the adult pastes into an agent: where the guide is, and the single-use code it connects with. */
export function agentPrompt(origin: string, pairingCode: string): string {
  return `Read ${origin}/agents.md and follow it to connect to my FamilyFi. My pairing code is ${pairingCode}`;
}

export const AGENT_GRANTS: readonly { value: AgentGrant; label: string; detail: string }[] = [
  { value: "controls", label: "Manage controls", detail: "Read the household, and change groups, rules, pauses, allowances and device assignment." },
  { value: "read", label: "Read only", detail: "Read groups, rules, devices and sync status. It cannot change anything." },
];

export function agentGrantLabel(grant: AgentGrant | null): string {
  return AGENT_GRANTS.find((option) => option.value === grant)?.label ?? "Read only";
}
