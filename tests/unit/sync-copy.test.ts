import { describe, expect, it } from "vitest";
import {
  changeActionLabel,
  changeResultLabel,
  familyNeedsDevices,
  relativeSweep,
  issueActionLabel,
  issueResultLabel,
  noMembersAttention,
  syncFailed,
  syncLogRows,
  syncProblem,
  syncStats,
  syncStatusCard,
} from "@/lib/sync-copy";
import type { SyncStatus } from "@/lib/types";

const sync = (over: Partial<SyncStatus> = {}): SyncStatus => ({
  revision: 4,
  connectionStatus: "ok",
  appPolicyCount: 3,
  failingCount: 0,
  issues: [],
  lastRun: { id: "r1", status: "applied", requestedRevision: 4, appliedRevision: 4, startedAt: "2026-09-14T19:50:00Z", finishedAt: "2026-09-14T19:58:00Z", error: null },
  changes: [],
  ...over,
});

describe("sync copy", () => {
  it("maps change scopes to parent-facing actions", () => {
    expect(changeActionLabel("pause")).toBe("Pause all internet");
    expect(changeActionLabel("allow")).toBe("Allow internet");
    expect(changeActionLabel("rule")).toBe("Update rule");
    expect(changeActionLabel("schedule")).toBe("Update schedule");
    expect(changeActionLabel("retry")).toBe("Reconcile sweep");
    expect(changeActionLabel("assignment")).toBe("Assign device");
  });

  it("points no-devices attention at assigning devices, not sync", () => {
    expect(
      noMembersAttention([
        {
          kind: "no_members",
          groupId: "betsy",
          groupName: "Betsy",
          message: "Betsy has no assigned devices, so its UniFi policies cannot be created.",
        },
      ]),
    ).toEqual({
      title: "Betsy needs devices",
      message: "Betsy has no assigned devices, so its UniFi policies cannot be created.",
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

  it("fills the four tiles from the sync status", () => {
    const now = new Date("2026-09-14T20:00:00Z");
    expect(syncStats(sync(), now)).toEqual([
      { label: "App-owned policies", value: "3", ink: "var(--ff-ink)", note: "named FamilyFi …" },
      { label: "Admin policies touched", value: "0", ink: "var(--ff-on)", note: "never modified or reordered" },
      { label: "Failing", value: "0", ink: "var(--ff-on)", note: "nothing queued" },
      { label: "Last sweep", value: "2m", ink: "var(--ff-ink)", note: "applied · revision 4" },
    ]);
    const failing = syncStats(
      sync({
        failingCount: 2,
        lastRun: null,
        issues: [
          { kind: "no_members", groupId: "g1", groupName: "A child", message: "needs a device" },
          { kind: "missing_policy", groupId: "g2", groupName: "A teen", message: "UniFi refused the policy" },
        ],
      }),
      now,
    );
    expect(failing[2]).toEqual({ label: "Failing", value: "2", ink: "var(--ff-danger)", note: "UniFi refused the policy" });
    expect(failing[3]).toMatchObject({ value: "Never", note: "no sweep yet" });
    expect(syncStats(null, now)[0]!.value).toBe("0");
  });

  it("lists current issues, then changes, as the log reads them", () => {
    const rows = syncLogRows(
      sync({
        issues: [{ kind: "no_members", groupId: "g1", groupName: "A child", message: "needs a device" }],
        changes: [
          { id: "c1", revision: 4, appliedRevision: 4, status: "applied", scope: "assignment", deviceMac: "02:00:00:00:00:0a", error: null, updatedAt: "2026-09-14T19:58:00Z" },
          { id: "c2", revision: 3, appliedRevision: null, status: "failed", scope: "pause", deviceMac: null, error: "UniFi timed out", updatedAt: "2026-09-14T19:40:00Z" },
          { id: "c3", revision: 2, appliedRevision: 2, status: "superseded", scope: "household", deviceMac: null, error: null, updatedAt: "2026-09-14T19:30:00Z" },
        ],
      }),
      "UTC",
    );
    expect(rows.map((row) => [row.key, row.action, row.detail, row.detailMono, row.result])).toEqual([
      ["issue-g1", "Needs assigned devices", "needs a device", false, "Can't create"],
      ["c1", "Assign device", "02:00:00:00:00:0A", true, "Applied"],
      ["c2", "Pause all internet", "UniFi timed out", false, "Failed"],
      ["c3", "Update household", null, false, "Superseded"],
    ]);
    expect(rows[0]!.when).toBe("Sep 14, 7:58 PM");
    expect(rows[2]!.detailInk).toBe("var(--ff-danger)");
    expect(syncLogRows(sync({ lastRun: null, issues: [{ kind: "missing_policy", groupId: "g2", groupName: "A teen", message: "m" }] }), "UTC")[0]!.when).toBe("Now");
    expect(syncLogRows(null, "UTC")).toEqual([]);
  });

  it("lists a failed sweep first, since no change row may carry its error", () => {
    const timeout = "UniFi GET /v1/sites/s1/firewall/zones?offset=0&limit=200 timed out";
    const rows = syncLogRows(sync({ lastRun: { ...sync().lastRun!, status: "failed", error: timeout } }), "UTC");
    expect(rows.map((row) => [row.key, row.action, row.detail, row.result, row.resultInk])).toEqual([
      ["run-r1", "Reconcile sweep", timeout, "Failed", "var(--ff-danger)"],
    ]);
    expect(rows[0]!.when).toBe("Sep 14, 7:58 PM");
    const now = new Date("2026-09-14T20:00:00Z");
    expect(syncStats(sync({ lastRun: { ...sync().lastRun!, status: "failed", error: timeout } }), now)[3]).toMatchObject({ ink: "var(--ff-danger)" });
  });

  it("never flags sync without a log row saying why", () => {
    const run = sync().lastRun!;
    const flaggedStates: SyncStatus[] = [
      sync({ lastRun: { ...run, status: "failed", error: "UniFi GET /v1/sites timed out" } }),
      sync({ connectionStatus: "error" }),
      sync({ connectionStatus: "error", lastRun: { ...run, status: "pending", finishedAt: null } }),
      sync({ connectionStatus: "error", lastRun: null }),
      sync({ failingCount: 1, lastRun: { ...run, status: "partial", error: "UniFi refused the policy" } }),
      sync({ failingCount: 2, lastRun: { ...run, status: "partial", error: null } }),
      sync({ failingCount: 1, lastRun: { ...run, status: "pending", finishedAt: null } }),
      sync({ failingCount: 1, lastRun: null }),
    ];
    for (const state of flaggedStates) {
      expect(syncFailed(state)).toBe(true);
      const first = syncLogRows(state, "UTC")[0];
      expect(first, JSON.stringify(state)).toBeDefined();
      expect(first!.resultInk).toBe("var(--ff-danger)");
      expect(first!.detail).toBeTruthy();
    }
    expect(syncLogRows(sync({ failingCount: 2, lastRun: { ...run, status: "partial", error: null } }), "UTC")[0]).toMatchObject({
      action: "Reconcile sweep",
      detail: "2 policies couldn't be written to UniFi.",
      result: "Partial",
    });
    expect(syncLogRows(sync({ connectionStatus: "error", lastRun: null }), "UTC")[0]).toMatchObject({ key: "connection", action: "Reach UniFi", result: "Failed" });
    expect(syncLogRows(sync(), "UTC")).toEqual([]);
  });

  it("explains why sync stopped and what to do about it", () => {
    const failed = (error: string | null) => sync({ connectionStatus: "error", lastRun: { ...sync().lastRun!, status: "failed", error } });
    expect(syncProblem(sync())).toBeNull();
    expect(syncProblem(sync({ failingCount: 2 }))).toBeNull();
    expect(syncProblem(null)).toBeNull();
    const timeout = "UniFi GET /v1/sites/s1/firewall/zones?offset=0&limit=200 timed out";
    expect(syncProblem(failed(timeout))).toMatchObject({ title: "UniFi isn't answering", detail: timeout });
    expect(syncProblem(failed(timeout))!.fix).toMatch(/every 30 seconds/);
    expect(syncProblem(failed("UniFi GET /v1/sites failed with HTTP 401: Unauthorized"))).toMatchObject({ title: "UniFi refused the API key" });
    expect(syncProblem(failed("No External/WAN firewall zone was found."))).toMatchObject({
      title: "Sync couldn't reach UniFi",
      detail: "No External/WAN firewall zone was found.",
    });
    // The connection is in error while the next sweep runs: the lost connection's error still explains it.
    expect(syncProblem(sync({ connectionStatus: "error", lastRun: { ...sync().lastRun!, status: "pending", error: timeout } }))).toMatchObject({
      title: "UniFi isn't answering",
      detail: timeout,
    });
    expect(syncProblem(sync({ connectionStatus: "error", lastRun: null }))).toMatchObject({ title: "Sync couldn't reach UniFi", detail: null });
  });

  it("says when sync needs attention, and counts groups waiting for a device", () => {
    expect(syncFailed(sync())).toBe(false);
    expect(syncFailed(sync({ failingCount: 1 }))).toBe(true);
    expect(syncFailed(sync({ connectionStatus: "error" }))).toBe(true);
    expect(syncFailed(null)).toBe(false);
    expect(familyNeedsDevices(sync({ issues: [{ kind: "no_members", groupId: "g1", groupName: "A", message: "" }, { kind: "missing_policy", groupId: "g2", groupName: "B", message: "" }] }))).toBe(1);
    expect(familyNeedsDevices(null)).toBe(0);
  });

  it("titles the status card and offers Reconcile now only when it helps", () => {
    expect(syncStatusCard(sync())).toEqual({
      title: "Gateway in sync",
      dot: "var(--ff-on)",
      message: "Desired state is written on the next reconcile.",
      showReconcile: false,
      reconcile: "Reconcile now",
    });
    const failed = sync({ lastRun: { ...sync().lastRun!, status: "failed", error: "UniFi unreachable" } });
    expect(syncStatusCard(failed)).toMatchObject({ title: "Sync needs attention", dot: "var(--ff-danger)", message: "UniFi unreachable", showReconcile: true });
    expect(syncStatusCard(sync({ connectionStatus: "unconfigured" }))).toMatchObject({ title: "UniFi not configured", dot: "var(--ff-muted)", showReconcile: true });
    expect(syncStatusCard(sync({ lastRun: { ...sync().lastRun!, status: "partial" } }))).toMatchObject({ title: "Partial apply", showReconcile: true });
    expect(syncStatusCard(sync(), { busy: true })).toMatchObject({ message: "Writing desired state to UniFi…", showReconcile: true, reconcile: "Reconciling…" });
    expect(syncStatusCard(failed, { error: "Saving failed" }).message).toBe("Saving failed");
    expect(syncStatusCard(sync(), { notice: "Saved." }).message).toBe("Saved.");
  });
});
