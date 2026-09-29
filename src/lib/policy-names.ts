/*
 * Names of the UniFi policies FamilyFi writes for a rule. Client-safe so the rule editor
 * can show the names before saving; the server uses the same functions. A name is only a
 * label for the household: ownership is always the recorded policy id, never the name.
 */

/** Every policy FamilyFi writes starts with this, so administrators can tell them apart. */
export const FAMILYFI_POLICY_PREFIX = "FamilyFi ";

/** UniFi's limit on a firewall policy name. */
export const MAX_POLICY_NAME = 100;

export type NamedRule = {
  id: string;
  name: string;
  useGeneratedName: boolean;
  mode: "always" | "scheduled";
  windows: { name: string }[];
};

/** The rule's part of every policy name: its name, or "Rule <id tail>" when generated. */
export function ruleBaseName(rule: Pick<NamedRule, "id" | "name" | "useGeneratedName">): string {
  if (rule.useGeneratedName) return `Rule ${rule.id.slice(-4).toUpperCase()}`;
  return rule.name.trim() || "Untitled rule";
}

/** "Window 2" when a window has no name of its own. */
export function windowLabel(window: { name: string }, index: number): string {
  return window.name.trim() || `Window ${index + 1}`;
}

/**
 * One name per UniFi policy the rule owns in a zone: one for an always-on rule, one per
 * window when scheduled. A second window adds the window's name after the rule's.
 */
export function rulePolicyNames(rule: NamedRule, zoneName = "Internal"): string[] {
  const base = ruleBaseName(rule);
  const tails =
    rule.mode === "always"
      ? [base]
      : rule.windows.length > 1
        ? rule.windows.map((window, index) => `${base} – ${windowLabel(window, index)}`)
        : rule.windows.map(() => base);
  return tails.map((tail) => withZone(`${FAMILYFI_POLICY_PREFIX}${tail}`, zoneName));
}

/** The policy for one zone of a multi-zone household names its zone, unless it is Internal. */
export function withZone(name: string, zoneName: string): string {
  if (isInternalZone(zoneName)) return clipName(name);
  return clipName(`${name} (${zoneLabel(zoneName)})`);
}

export function isInternalZone(zoneName: string): boolean {
  return zoneLabel(zoneName).toLowerCase() === "internal";
}

export function zoneLabel(zoneName: string): string {
  return zoneName.trim() || "Unknown";
}

export function clipName(name: string): string {
  if (name.length <= MAX_POLICY_NAME) return name;
  return name.slice(0, MAX_POLICY_NAME - 1).trimEnd() + "…";
}
