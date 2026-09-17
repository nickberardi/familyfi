import { describe, expect, it } from "vitest";
import { beginMutate, canCommitMutate, type MutateGate } from "@/lib/mutate-gate";
import { applyMutationResult, assignDeviceLocally } from "@/lib/household-state";
import type { Device, Group } from "@/lib/types";

function group(overrides: Partial<Group> = {}): Group {
  return {
    id: "g1",
    kind: "family",
    name: "Betsy",
    monogram: null,
    familyRole: "child",
    protected: false,
    mode: "scheduled",
    deviceCount: 1,
    schedule: { enabled: true, days: [1, 2, 3, 4, 5], start: "21:30", end: "06:45" },
    suspension: { active: false, until: null },
    dohOverrideUrl: null,
    access: "available",
    ...overrides,
  };
}

function device(overrides: Partial<Device> = {}): Device {
  return {
    mac: "aa:bb:cc:dd:ee:01",
    hostname: "Betsy iPhone",
    ip: "192.168.1.20",
    networkId: "lan",
    zoneId: "zone",
    groupId: "g1",
    assignment: "assigned",
    lastSeenAt: null,
    unresolved: false,
    inScope: true,
    ...overrides,
  };
}

describe("mutate-gate", () => {
  it("only the latest mutate may apply or roll back", () => {
    const gate: MutateGate = { latest: 0 };
    const first = beginMutate(gate);
    const second = beginMutate(gate);
    expect(canCommitMutate(gate, first)).toBe(false);
    expect(canCommitMutate(gate, second)).toBe(true);
  });

  it("ignores a stale successful apply after a newer mutate started", () => {
    const gate: MutateGate = { latest: 0 };
    let state = { groups: [group(), group({ id: "g2", name: "Pat", deviceCount: 0 })], devices: [device()] };
    const first = beginMutate(gate);
    state = assignDeviceLocally(state, device().mac, "g2");
    const second = beginMutate(gate);
    state = assignDeviceLocally(state, device().mac, null);

    // First request returns late — must not commit over the newer local state.
    if (canCommitMutate(gate, first)) {
      state = applyMutationResult(state, {
        device: { ...device(), groupId: "g2", assignment: "assigned" },
      });
    }
    expect(state.devices[0]?.groupId).toBeNull();
    expect(canCommitMutate(gate, second)).toBe(true);
  });

  it("ignores a stale rollback after a newer mutate started", () => {
    const gate: MutateGate = { latest: 0 };
    const baseline = { groups: [group()], devices: [device()] };
    let state = baseline;
    const first = beginMutate(gate);
    const firstPrevious = state;
    state = assignDeviceLocally(state, device().mac, null);
    const second = beginMutate(gate);
    state = assignDeviceLocally(state, device().mac, "g1");

    // First request fails late — must not roll back the newer mutate.
    if (canCommitMutate(gate, first)) {
      state = firstPrevious;
    }
    expect(state.devices[0]?.groupId).toBe("g1");
    expect(canCommitMutate(gate, second)).toBe(true);
  });
});
