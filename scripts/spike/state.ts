import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type SpikeLiveState = {
  siteId: string;
  installId: string;
  macs: string[];
  policyIds: string[];
  orderingBefore: { afterSystemDefined: string[]; beforeSystemDefined: string[] };
  createdAt: string;
};

const defaultPath = join(dirname(fileURLToPath(import.meta.url)), ".live-state.json");

export function spikeStatePath(): string {
  return process.env.UNIFI_SPIKE_STATE_FILE?.trim() || defaultPath;
}

export function readSpikeState(): SpikeLiveState | null {
  try {
    return JSON.parse(readFileSync(spikeStatePath(), "utf8")) as SpikeLiveState;
  } catch {
    return null;
  }
}

export function writeSpikeState(state: SpikeLiveState): void {
  const path = spikeStatePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

export function clearSpikeState(): void {
  try {
    rmSync(spikeStatePath());
  } catch {
    // absent
  }
}
