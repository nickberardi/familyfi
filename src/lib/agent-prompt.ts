import type { DeviceScope } from "./types";

/** What the adult pastes into an agent: where the guide is, and the single-use code it connects with. */
export function agentPrompt(origin: string, pairingCode: string): string {
  return `Read ${origin}/agents.md and follow it to connect to my FamilyFi. My pairing code is ${pairingCode}`;
}

/** The scopes an adult may give an agent. */
export const AGENT_SCOPES: readonly { value: "full" | "readOnly"; label: string; detail: string }[] = [
  { value: "full", label: "Full access", detail: "Read the household, and change groups, rules, pauses, allowances and device assignment." },
  { value: "readOnly", label: "Read only", detail: "Read groups, rules, devices and sync status. It cannot change anything." },
];

const SCOPE_LABELS: Record<DeviceScope, string> = { full: "Full access", rulesOnly: "Rules only", readOnly: "Read only" };

export function scopeLabel(scope: DeviceScope): string {
  return SCOPE_LABELS[scope];
}
