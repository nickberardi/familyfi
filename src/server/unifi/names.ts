import { clipName, FAMILYFI_POLICY_PREFIX, zoneLabel } from "@/lib/policy-names";

export { isInternalZone, rulePolicyNames } from "@/lib/policy-names";

export function quarantinePolicyName(zoneName: string): string {
  return clipName(`${FAMILYFI_POLICY_PREFIX}Quarantine ${zoneLabel(zoneName)} Devices`);
}

/** The name of a group's built-in rule, which is what names its block policy while the group is paused. */
export function pauseRuleName(input: { name: string; kind: "family" | "things" }): string {
  const subject = input.kind === "family" ? possessive(input.name) : input.name.trim() || "Group";
  return `${subject} Internet Pause`;
}

export function spikePolicyName(zoneName: string): string {
  return clipName(`${FAMILYFI_POLICY_PREFIX}Spike ${zoneLabel(zoneName)} Devices`);
}

function possessive(name: string): string {
  const trimmed = name.trim() || "Group";
  if (/s$/i.test(trimmed)) return `${trimmed}'`;
  return `${trimmed}'s`;
}
