import { FAMILYFI_POLICY_PREFIX } from "./types";

const MAX_POLICY_NAME = 100;

export function quarantinePolicyName(zoneName: string): string {
  return clipName(`${FAMILYFI_POLICY_PREFIX}Quarantine ${zoneLabel(zoneName)} Devices`);
}

export function groupPolicyName(input: { name: string; kind: "family" | "things"; zoneName: string }): string {
  const access =
    input.kind === "family" ? `${possessive(input.name)} Internet Access` : `${input.name.trim() || "Group"} Internet Access`;
  const base = `${FAMILYFI_POLICY_PREFIX}${access}`;
  if (isInternalZone(input.zoneName)) return clipName(base);
  return clipName(`${base} (${zoneLabel(input.zoneName)})`);
}

export function spikePolicyName(zoneName: string): string {
  return clipName(`${FAMILYFI_POLICY_PREFIX}Spike ${zoneLabel(zoneName)} Devices`);
}

export function isInternalZone(zoneName: string): boolean {
  return zoneLabel(zoneName).toLowerCase() === "internal";
}

function possessive(name: string): string {
  const trimmed = name.trim() || "Group";
  if (/s$/i.test(trimmed)) return `${trimmed}'`;
  return `${trimmed}'s`;
}

function zoneLabel(zoneName: string): string {
  const trimmed = zoneName.trim();
  return trimmed || "Unknown";
}

function clipName(name: string): string {
  if (name.length <= MAX_POLICY_NAME) return name;
  return name.slice(0, MAX_POLICY_NAME - 1).trimEnd() + "…";
}

export function dpiRulePolicyName(input: {
  groupName: string;
  kind: "family" | "things";
  ruleKind: "category" | "app";
  zoneName: string;
  targetIds: number[];
}): string {
  const label = input.ruleKind === "category" ? "Category" : "App";
  const ids = [...input.targetIds].sort((a, b) => a - b).join(",");
  const subject =
    input.kind === "family"
      ? `${possessive(input.groupName)} ${label}`
      : `${input.groupName.trim() || "Group"} ${label}`;
  const base = `${FAMILYFI_POLICY_PREFIX}${subject} ${ids}`;
  if (isInternalZone(input.zoneName)) return clipName(base);
  return clipName(`${base} (${zoneLabel(input.zoneName)})`);
}

export function dpiNetworkRulePolicyName(input: {
  networkLabel: string;
  ruleKind: "category" | "app";
  zoneName: string;
  targetIds: number[];
}): string {
  const label = input.ruleKind === "category" ? "Category" : "App";
  const ids = [...input.targetIds].sort((a, b) => a - b).join(",");
  const subject = `${input.networkLabel.trim() || "Network"} ${label}`;
  const base = `${FAMILYFI_POLICY_PREFIX}${subject} ${ids}`;
  if (isInternalZone(input.zoneName)) return clipName(base);
  return clipName(`${base} (${zoneLabel(input.zoneName)})`);
}
