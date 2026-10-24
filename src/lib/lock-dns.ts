/**
 * The built-in Lock DNS rule's page, shared by every client: what it blocks, what it applies to
 * (people and things, or whole networks, as any rule), and what saving that writes to UniFi.
 */
import { ENCRYPTED_DNS_SERVICES, encryptedDnsHosts, encryptedDnsSummary } from "./encrypted-dns";
import type { HouseholdStore } from "./household-store";
import { LOCK_DNS_PARTS, lockDnsPolicyName, type LockDnsPart } from "./policy-names";
import { appliesToAny, appliesToBody, sameAppliesTo, type AppliesTo } from "./rule-editor";
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
    note: "People and things, or whole networks. Category, app and website rules can’t be gotten around for these.",
    things: "Smart TVs and streaming sticks often insist on Google’s DNS and may stop working with it on.",
    noNetwork: "Pick at least one network.",
  },
  writes: {
    title: "What FamilyFi will write",
    note: "Applied on the next reconcile. Your own UniFi policies are never touched.",
    none: "Nothing until it applies to something.",
  },
} as const;

const PART_DETAIL: Record<LockDnsPart, string> = {
  ports: "Blocks DNS and DNS over TLS to the internet",
  addresses: `Blocks ${ENCRYPTED_DNS_SERVICES.length} encrypted DNS services by IPv4 address`,
  "addresses-v6": `Blocks ${ENCRYPTED_DNS_SERVICES.length} encrypted DNS services by IPv6 address`,
  names: `Blocks ${encryptedDnsHosts().length} encrypted DNS host names`,
};

/** What Lock DNS applies to, saved or being picked. */
export type LockDnsDraft = AppliesTo;

export function fromLockDnsRule(rule: Pick<Rule, "scope" | "groupIds" | "networkIds">): LockDnsDraft {
  return { scope: rule.scope, groupIds: [...rule.groupIds], networkIds: [...rule.networkIds] };
}

/**
 * What saving the pick writes, policy by policy: Lock DNS has its policies while it applies to
 * something, and a change of what it applies to changes each of them.
 */
export function lockDnsWrites(saved: LockDnsDraft, picked: LockDnsDraft): RuleWrite[] {
  // Whole networks with none picked can't be saved, so it previews nothing changing, never a delete.
  const draft = validateLockDnsDraft(picked) ? saved : picked;
  if (!appliesToAny(saved) && !appliesToAny(draft)) return [];
  return LOCK_DNS_PARTS.map((part) => {
    const name = lockDnsPolicyName(part);
    if (!appliesToAny(saved)) return { verb: "NEW", name, detail: PART_DETAIL[part] };
    if (!appliesToAny(draft)) return { verb: "DELETE", name, detail: "Applies to nothing" };
    return sameAppliesTo(saved, draft) ? { verb: "KEEP", name, detail: PART_DETAIL[part] } : { verb: "CHANGE", name, detail: "Applies to changed" };
  });
}

/** Why the pick cannot be saved, or null. Covering no group is allowed; whole networks need one. */
export function validateLockDnsDraft(draft: LockDnsDraft): string | null {
  return draft.scope === "network" && draft.networkIds.length === 0 ? LOCK_DNS_COPY.appliesTo.noNetwork : null;
}

/** Whether the pick differs from the saved rule. */
export function lockDnsDirty(rule: Pick<Rule, "scope" | "groupIds" | "networkIds">, draft: LockDnsDraft): boolean {
  return !sameAppliesTo(fromLockDnsRule(rule), draft);
}

/** Saves what Lock DNS applies to; resolves to the store's payload, or undefined when it failed. */
export function saveLockDns(mutate: HouseholdStore["mutate"], rule: Pick<Rule, "id">, draft: LockDnsDraft) {
  return mutate((send) => send<{ rule: Rule }>(`/api/v1/rules/${rule.id}`, { method: "PATCH", body: appliesToBody(draft) }), {
    feedback: { notice: "Lock DNS saved. FamilyFi writes it to the gateway next." },
  });
}
