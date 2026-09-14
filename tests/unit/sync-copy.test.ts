import { describe, expect, it } from "vitest";
import { changeActionLabel, changeResultLabel, relativeSweep, issueActionLabel, issueResultLabel, noMembersAttention } from "@/lib/sync-copy";

describe("sync copy", () => {
  it("maps change scopes to parent-facing actions", () => {
    expect(changeActionLabel("pause")).toBe("Pause schedule");
    expect(changeActionLabel("retry")).toBe("Reconcile sweep");
    expect(changeActionLabel("assignment")).toBe("Assign device");
  });

  it("points bedtime-without-devices attention at assigning devices, not sync", () => {
    expect(
      noMembersAttention([
        {
          kind: "no_members",
          groupId: "betsy",
          groupName: "Betsy",
          message: "Betsy has a bedtime but no assigned devices, so a UniFi policy cannot be created.",
        },
      ]),
    ).toEqual({
      title: "Betsy needs devices",
      message: "Betsy has a bedtime but no assigned devices, so a UniFi policy cannot be created.",
      href: "/devices?assign=betsy",
    });
    expect(issueActionLabel("no_members")).toBe("Needs assigned devices");
    expect(issueResultLabel("no_members")).toBe("Can't create");
    expect(issueResultLabel("missing_policy")).toBe("Failed");
  });

  it("labels results without claiming back online", () => {
    expect(changeResultLabel("applied")).toBe("Applied");
    expect(changeResultLabel("failed")).toBe("Failed");
  });

  it("summarizes last sweep age", () => {
    const now = new Date("2026-09-14T20:00:00Z");
    expect(relativeSweep("2026-09-14T19:58:00Z", now)).toBe("2m");
    expect(relativeSweep(null, now)).toBe("Never");
  });
});
