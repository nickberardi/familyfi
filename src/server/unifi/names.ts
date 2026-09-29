import { clipName, FAMILYFI_POLICY_PREFIX, withZone, zoneLabel } from "@/lib/policy-names";

export { isInternalZone, rulePolicyNames } from "@/lib/policy-names";

export function quarantinePolicyName(zoneName: string): string {
  return clipName(`${FAMILYFI_POLICY_PREFIX}Quarantine ${zoneLabel(zoneName)} Devices`);
}

/** The block policy that exists only while a group is paused. */
export function pausePolicyName(input: { name: string; kind: "family" | "things"; zoneName: string }): string {
  const subject = input.kind === "family" ? possessive(input.name) : input.name.trim() || "Group";
  return withZone(`${FAMILYFI_POLICY_PREFIX}${subject} Internet Pause`, input.zoneName);
}

export function spikePolicyName(zoneName: string): string {
  return clipName(`${FAMILYFI_POLICY_PREFIX}Spike ${zoneLabel(zoneName)} Devices`);
}

function possessive(name: string): string {
  const trimmed = name.trim() || "Group";
  if (/s$/i.test(trimmed)) return `${trimmed}'`;
  return `${trimmed}'s`;
}
