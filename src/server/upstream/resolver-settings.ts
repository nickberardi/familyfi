import type { Group, Household } from "@prisma/client";

export class ResolverConfigError extends Error {}

/**
 * A DoH endpoint is configuration, not a credential, so it is stored and returned in
 * full. Its path may carry an account or profile id — enough for someone to spend that
 * profile's quota and appear in its logs, not enough to read those logs or change a
 * setting — which puts it in the same bracket as the rest of the household config:
 * worth keeping out of a pasted dump, not worth hiding from the operator who typed it.
 *
 * Hiding it actively hurt: a mistyped profile id showed a mask and an unknown verdict
 * with no way to see the mistake.
 */

/** Must be an absolute HTTPS URL. Plain HTTP would put DNS queries back in the clear. */
export function normalizeResolverUrl(raw: string): string {
  const value = raw.trim();
  if (!value) throw new ResolverConfigError("Paste the DNS-over-HTTPS endpoint.");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ResolverConfigError("That is not a URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new ResolverConfigError("The endpoint must start with https://.");
  }
  if (!parsed.hostname.includes(".")) {
    throw new ResolverConfigError("That URL has no host.");
  }
  return parsed.toString();
}

export function householdResolverUrl(household: Household): string | null {
  return household.dohUrl;
}

export function groupResolverOverride(group: Group): string | null {
  return group.dohOverrideUrl;
}

/**
 * A group's own endpoint when it has one, otherwise the household default — the
 * "Uses the household default set in Categories" case in the design.
 *
 * This is why a verdict cannot be a single household-wide value: a group pointed at a
 * stricter resolver is filtered differently from the rest of the house, and reporting
 * the household's answer for it would be wrong in the direction that matters.
 */
export function resolverUrlForGroup(household: Household, group: Group | null): string | null {
  return (group && groupResolverOverride(group)) || householdResolverUrl(household);
}

/** Groups sharing an endpoint share a verdict, so a sweep runs once per distinct URL. */
export function distinctResolvers(
  household: Household,
  groups: Group[],
): { url: string; groupIds: (string | null)[] }[] {
  const byUrl = new Map<string, (string | null)[]>();
  const add = (url: string | null, groupId: string | null) => {
    if (!url) return;
    byUrl.set(url, [...(byUrl.get(url) ?? []), groupId]);
  };
  add(householdResolverUrl(household), null);
  for (const group of groups) add(groupResolverOverride(group), group.id);
  return [...byUrl.entries()].map(([url, groupIds]) => ({ url, groupIds }));
}
