import { AssignmentState } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { coverageIssues, isWriteFailure } from "@/server/policy-coverage";

const betsy = { id: "betsy", name: "Betsy", protected: false, scheduleEnabled: true };
const abby = { id: "abby", name: "Abby", protected: false, scheduleEnabled: true };
const nick = { id: "nick", name: "Nick", protected: true, scheduleEnabled: false };

describe("policy coverage", () => {
  it("flags a scheduled group with no assigned devices and no UniFi policy", () => {
    const issues = coverageIssues({
      groups: [betsy, nick],
      devices: [],
      policies: [],
    });
    expect(issues).toEqual([
      {
        groupId: "betsy",
        groupName: "Betsy",
        kind: "no_members",
        message: "Betsy has a bedtime but no assigned devices, so a UniFi policy cannot be created.",
      },
    ]);
    expect(issues.every((issue) => !isWriteFailure(issue))).toBe(true);
  });

  it("flags assigned devices that never produced a UniFi policy", () => {
    const issues = coverageIssues({
      groups: [abby],
      devices: [
        { groupId: "abby", assignment: AssignmentState.assigned, zoneId: "z1", inScope: true },
      ],
      policies: [],
    });
    expect(issues[0]?.message).toBe("Abby has no UniFi policy.");
    expect(issues[0]?.kind).toBe("missing_policy");
    expect(isWriteFailure(issues[0]!)).toBe(true);
  });

  it("does not flag protected groups or groups that already have a live policy", () => {
    const issues = coverageIssues({
      groups: [nick, abby],
      devices: [{ groupId: "abby", assignment: AssignmentState.assigned, zoneId: "z1", inScope: true }],
      policies: [{ groupId: "abby", unifiPolicyId: "pol-1", lastError: null }],
    });
    expect(issues).toEqual([]);
  });
});
