import { describe, expect, it } from "vitest";
import {
  applyMutationResult,
  asMutationPayload,
  assignDeviceLocally,
  removeGroupLocally,
} from "@/lib/household-state";
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

describe("applyMutationResult", () => {
  it("seeds a created group so detail can render before reload", () => {
    const created = group({ id: "g-new", name: "Sam", deviceCount: 0 });
    const next = applyMutationResult({ groups: [group()], devices: [] }, { group: created });
    expect(next.groups.find((item) => item.id === "g-new")?.name).toBe("Sam");
    expect(next.groups).toHaveLength(2);
  });

  it("replaces an edited group in place", () => {
    const next = applyMutationResult(
      { groups: [group()], devices: [] },
      { group: group({ name: "Elizabeth", protected: true, access: "protected" }) },
    );
    expect(next.groups).toHaveLength(1);
    expect(next.groups[0]?.name).toBe("Elizabeth");
    expect(next.groups[0]?.protected).toBe(true);
  });

  it("quarantines members when a group is deleted", () => {
    const next = applyMutationResult(
      { groups: [group(), group({ id: "g2", name: "Pat", deviceCount: 0 })], devices: [device()] },
      { removedGroupId: "g1" },
    );
    expect(next.groups.map((item) => item.id)).toEqual(["g2"]);
    expect(next.devices[0]?.groupId).toBeNull();
    expect(next.devices[0]?.assignment).toBe("quarantined");
    expect(
      removeGroupLocally({ groups: [group()], devices: [device()] }, "g1").groups,
    ).toEqual([]);
  });

  it("reads group from an untyped mutation JSON body", () => {
    const created = group({ id: "g-new", name: "Sam", deviceCount: 0 });
    const payload = asMutationPayload({ group: created, change: { changeId: "c1" } });
    const next = applyMutationResult({ groups: [], devices: [] }, payload);
    expect(next.groups[0]?.id).toBe("g-new");
  });

  it("updates assignment and device counts without waiting on UniFi", () => {
    const state = {
      groups: [group({ deviceCount: 1 }), group({ id: "g2", name: "Pat", deviceCount: 0 })],
      devices: [device()],
    };
    const optimistic = assignDeviceLocally(state, device().mac, "g2");
    expect(optimistic.devices[0]?.groupId).toBe("g2");
    expect(optimistic.groups.find((item) => item.id === "g1")?.deviceCount).toBe(0);
    expect(optimistic.groups.find((item) => item.id === "g2")?.deviceCount).toBe(1);

    const fromServer = applyMutationResult(optimistic, {
      device: { ...device(), groupId: "g2", assignment: "assigned" },
    });
    expect(fromServer.groups.find((item) => item.id === "g1")?.deviceCount).toBe(0);
    expect(fromServer.groups.find((item) => item.id === "g2")?.deviceCount).toBe(1);
  });

  it("unassigns a device back to quarantine", () => {
    const next = assignDeviceLocally(
      { groups: [group({ deviceCount: 1 })], devices: [device()] },
      device().mac,
      null,
    );
    expect(next.devices[0]?.assignment).toBe("quarantined");
    expect(next.groups[0]?.deviceCount).toBe(0);
  });
});
