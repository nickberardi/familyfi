import { sha256 } from "../crypto";
import type { FirewallPolicyWrite } from "./types";

export function sortedMacs(macs: string[]): string[] {
  return [...new Set(macs)].sort();
}

export function policyFingerprint(write: FirewallPolicyWrite): string {
  return sha256(
    JSON.stringify({
      name: write.name,
      enabled: write.enabled,
      action: write.action,
      ipProtocolScope: write.ipProtocolScope,
      source: write.source,
      destination: write.destination,
      schedule: write.schedule ?? null,
    }),
  );
}
