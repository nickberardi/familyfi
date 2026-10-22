/**
 * The built-in Lock DNS rule's page, shared by every client: what it blocks, the groups it covers,
 * and what saving them writes to UniFi.
 */
import { ENCRYPTED_DNS_SERVICES, encryptedDnsHosts, encryptedDnsSummary } from "./encrypted-dns";
import type { HouseholdStore } from "./household-store";
import { LOCK_DNS_PARTS, lockDnsPolicyName, type LockDnsPart } from "./policy-names";
import type { RuleWrite } from "./rule-writes";
import type { Rule } from "./rules";

export const LOCK_DNS_COPY = {
  title: "Lock DNS",
  summary: `Built in · always · ${LOCK_DNS_PARTS.length} UniFi policies`,
  back: "All rules",
  save: "Save",
  unsaved: "Unsaved changes",
  blocks: {
    title: "What it blocks",
    note: "The ways around your gateway’s DNS. Websites and apps keep working.",
    items: [
      {
        title: "Other DNS servers on the internet",
        body: "Plain DNS and DNS over TLS to anything but your gateway. A DNS server on your own network, like a Pi-hole, and the DNS servers your networks hand out still work.",
      },
      {
        title: "Known encrypted DNS services",
        body: `${encryptedDnsSummary()}, by address and by name, except a resolver you set in FamilyFi. Each FamilyFi release keeps this list up to date.`,
      },
    ],
    caution: "A phone set to its own private DNS name loses internet until that setting goes back to Automatic.",
  },
  appliesTo: {
    title: "Applies to",
    note: "People and things. Category, app and website rules can’t be gotten around for these.",
    label: "Groups",
    things: "Smart TVs and streaming sticks often insist on Google’s DNS and may stop working with it on.",
  },
  writes: {
    title: "What FamilyFi will write",
    note: "Applied on the next reconcile. Your own UniFi policies are never touched.",
    none: "Nothing until it covers a group.",
  },
} as const;

const PART_DETAIL: Record<LockDnsPart, string> = {
  ports: "Blocks DNS and DNS over TLS to the internet",
  addresses: `Blocks ${ENCRYPTED_DNS_SERVICES.length} encrypted DNS services by IPv4 address`,
  "addresses-v6": `Blocks ${ENCRYPTED_DNS_SERVICES.length} encrypted DNS services by IPv6 address`,
  names: `Blocks ${encryptedDnsHosts().length} encrypted DNS host names`,
};

const sameGroups = (a: readonly string[], b: readonly string[]) => [...a].sort().join() === [...b].sort().join();

/**
 * What saving the groups writes, policy by policy: Lock DNS has its policies while it covers a
 * group, and a change of groups changes each of them.
 */
export function lockDnsWrites(savedGroupIds: readonly string[], groupIds: readonly string[]): RuleWrite[] {
  if (savedGroupIds.length === 0 && groupIds.length === 0) return [];
  return LOCK_DNS_PARTS.map((part) => {
    const name = lockDnsPolicyName(part);
    if (savedGroupIds.length === 0) return { verb: "NEW", name, detail: PART_DETAIL[part] };
    if (groupIds.length === 0) return { verb: "DELETE", name, detail: "No group left to cover" };
    return sameGroups(savedGroupIds, groupIds) ? { verb: "KEEP", name, detail: PART_DETAIL[part] } : { verb: "CHANGE", name, detail: "Groups changed" };
  });
}

/** Whether the picked groups differ from the saved ones. */
export function lockDnsDirty(rule: Pick<Rule, "groupIds">, groupIds: readonly string[]): boolean {
  return !sameGroups(rule.groupIds, groupIds);
}

/** Picks a group, or lets it go. */
export function toggleLockDnsGroup(groupIds: readonly string[], groupId: string): string[] {
  return groupIds.includes(groupId) ? groupIds.filter((id) => id !== groupId) : [...groupIds, groupId];
}

/** Saves the groups Lock DNS covers; resolves to the store's payload, or undefined when it failed. */
export function saveLockDnsGroups(mutate: HouseholdStore["mutate"], rule: Pick<Rule, "id">, groupIds: string[]) {
  return mutate((send) => send<{ rule: Rule }>(`/api/v1/rules/${rule.id}`, { method: "PATCH", body: { groupIds } }), {
    feedback: { notice: "Lock DNS saved. FamilyFi writes it to the gateway next." },
  });
}
