import { carriesWrite } from "./lost-creates";
import { normalizeMac } from "../mac";
import type { FirewallPolicy, FirewallPolicyWrite } from "./types";

/**
 * Gateway drift: one of FamilyFi's own policies that someone changed in the UniFi console. Sync
 * compares each recorded policy on the gateway with the write FamilyFi last confirmed, records what
 * differs on the policy's row, and writes FamilyFi's version back. Checkup says what was put back.
 */

/** What differed, field by field, in the words Checkup shows. Device lists are MAC addresses. */
export type GatewayDriftChange =
  | { field: "switch"; familyfi: boolean; gateway: boolean }
  | { field: "devices"; familyfi: string[]; gateway: string[] }
  | { field: "schedule"; familyfi: "always" | "scheduled"; gateway: "always" | "scheduled" | "different" }
  | { field: "name"; familyfi: string; gateway: string }
  | { field: "other" };

const macsOf = (endpoint: { trafficFilter?: unknown } | undefined): string[] | null => {
  const filter = endpoint?.trafficFilter as { macAddressFilter?: { macAddresses?: string[] } } | undefined;
  const macs = filter?.macAddressFilter?.macAddresses;
  return macs ? [...new Set(macs.map(normalizeMac))].sort() : null;
};

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((item, index) => item === b[index]);

/**
 * How `actual`, the gateway's copy, differs from `write`, the version FamilyFi last confirmed; empty
 * when it still carries the whole write. Only fields the write sets count: the gateway fills in
 * defaults of its own.
 */
export function gatewayDrift(actual: FirewallPolicy, write: FirewallPolicyWrite): GatewayDriftChange[] {
  const changes: GatewayDriftChange[] = [];
  if (actual.enabled !== write.enabled) changes.push({ field: "switch", familyfi: write.enabled, gateway: actual.enabled });
  const wanted = macsOf(write.source);
  const found = macsOf(actual.source);
  if (wanted && !sameList(wanted, found ?? [])) changes.push({ field: "devices", familyfi: wanted, gateway: found ?? [] });
  const schedule = write.schedule ?? null;
  if (!carriesWrite(actual.schedule ?? null, schedule)) {
    changes.push({
      field: "schedule",
      familyfi: schedule ? "scheduled" : "always",
      gateway: !actual.schedule ? "always" : schedule ? "different" : "scheduled",
    });
  }
  if (actual.name !== write.name) changes.push({ field: "name", familyfi: write.name, gateway: actual.name });
  // The rest of what FamilyFi's fingerprint covers: what it blocks, where, and how. A description
  // or logging switch FamilyFi never compares is never drift.
  const rest = JSON.parse(JSON.stringify({ action: write.action, ipProtocolScope: write.ipProtocolScope, source: write.source, destination: write.destination }));
  if (wanted) delete rest.source.trafficFilter.macAddressFilter;
  if (!carriesWrite(actual, rest)) changes.push({ field: "other" });
  return changes;
}
