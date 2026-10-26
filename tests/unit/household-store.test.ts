/**
 * The shared household store (`src/lib/household-store.ts`) and writes (`src/lib/group-writes.ts`)
 * against a fake server: the mutate flow (optimistic merge, server result, change polling,
 * reload), the web's default refresh handling, and the offline guard a phone uses, under which a
 * stale view never sends or queues a write.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, TransportError, type ApiRequest } from "@/lib/api-client";
import {
  applyGroupPause,
  applyGroupSheet,
  applyRulePause,
  assignDevice,
  createGroup,
  deleteGroup,
  resumeGroupRules,
  runGroupHeaderAction,
  updateGroup,
} from "@/lib/group-writes";
import { createHouseholdStore, NOTICE_MS, NOTICE_WITH_ACTION_MS, type OfflineGuard } from "@/lib/household-store";
import type { Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";

/** A child group with a scheduled internet window, online now. */
function childGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: "group-child",
    kind: "family",
    name: "A child",
    monogram: null,
    familyRole: "child",
    deviceCount: 2,
    suspension: { active: false, until: null, by: null },
    allowance: { active: false, until: null, by: null },
    internetRuleIds: ["rule-bedtime"],
    access: "available",
    dohOverrideUrl: null,
    ...overrides,
  };
}

const bedtime = { id: "rule-bedtime", name: "Bedtime", kind: "internet", groupIds: ["group-child"] } as unknown as Rule;

type Reply = { status?: number; json: unknown } | Promise<never>;
type Handler = (body: unknown) => Reply | Promise<Reply>;

/** A fake server: routes by `METHOD path`, records every request, and fails like a transport would. */
function fakeServer(routes: Record<string, Handler>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const request: ApiRequest = async <T,>(path: string, init: { method?: string; body?: unknown } = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, path, body: init.body });
    const handler = routes[`${method} ${path}`];
    if (!handler) throw new ApiError("No route", 404, "not_found");
    const { status = 200, json } = await handler(init.body);
    if (status >= 400) {
      const error = (json as { error: { message: string; code?: string } }).error;
      throw new ApiError(error.message, status, error.code);
    }
    return json as T;
  };
  return { request, calls };
}

const offline = () => Promise.reject(new TransportError(new TypeError("Network request failed"))) as never;

function reads(group: () => Group): Record<string, Handler> {
  return {
    "GET /api/v1/auth/session": () => ({ json: { session: { username: "admin", displayName: "An adult", kind: "recovery", expiresAt: "2030-01-01T00:00:00Z" } } }),
    "GET /api/v1/groups": () => ({ json: { groups: [group()] } }),
    "GET /api/v1/devices": () => ({ json: { devices: [] } }),
    "GET /api/v1/rules": () => ({ json: { rules: [bedtime] } }),
    "GET /api/v1/sync": () => ({ json: { revision: 1, connectionStatus: "ok" } }),
    "GET /api/v1/settings/unifi": () => ({ json: { unifi: { configured: true } } }),
    "GET /api/v1/settings/household": () => ({ json: { household: { timezone: "America/New_York", revision: 1, displayName: "A household" } } }),
    "GET /api/v1/accounts": () => ({ json: { accounts: [{ id: "account-1", displayName: "An adult" }] } }),
  };
}

const GUARD: OfflineGuard = { stale: "Out of date.", notSent: "Not sent.", maybeNotSent: "May not have been sent." };

function setup(
  routes: Record<string, Handler>,
  { outcome = { status: "applied", error: null as string | null }, offlineGuard }: { outcome?: { status: string; error: string | null }; offlineGuard?: OfflineGuard } = {},
) {
  const server = fakeServer(routes);
  const waitForChange = vi.fn(async () => outcome);
  const store = createHouseholdStore({ request: server.request, waitForChange, offlineGuard });
  return { store, server, waitForChange };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe("household store", () => {
  it("reads every household list in parallel after the session", async () => {
    const { store, server } = setup(reads(() => childGroup()));
    await store.reload();
    const state = store.getState();
    expect(state).toMatchObject({ status: "ready", loaded: true, stale: false, error: "" });
    expect(state.groups.map((group) => group.id)).toEqual(["group-child"]);
    expect(state.household?.displayName).toBe("A household");
    expect(state.accounts).toHaveLength(1);
    expect(state.unifi).toEqual({ configured: true });
    expect(server.calls[0]?.path).toBe("/api/v1/auth/session");
    expect(server.calls).toHaveLength(8);
  });

  it("pauses a group: server result, notice with Undo, change polling, then a reload", async () => {
    let current = childGroup();
    const paused = childGroup({ access: "paused", suspension: { active: true, until: null, by: { accountId: null, name: "An adult" } } });
    const { store, server, waitForChange } = setup({
      ...reads(() => current),
      "POST /api/v1/groups/group-child/rules/internet/pause": (body) => {
        expect(body).toEqual({});
        current = paused;
        return { json: { group: paused, change: { changeId: "change-1", revision: 2 } } };
      },
    });
    await store.reload();
    const pending = applyGroupPause(store.mutate, current, { kind: "pauseUntil", until: null }, "America/New_York");
    // While the write is in flight the group is busy, so a second tap sends nothing.
    expect(store.getState()).toMatchObject({ busy: true, busyGroupIds: ["group-child"] });
    await expect(runGroupHeaderAction(store.mutate, current, "unblockNow")).resolves.toBeUndefined();
    await pending;
    const state = store.getState();
    expect(state.groups[0]?.access).toBe("paused");
    expect(state.notice).toBe("All internet blocked for A child until you unblock.");
    expect(state.noticeAction?.label).toBe("Undo");
    expect(state).toMatchObject({ busy: false, busyGroupIds: [] });
    await flush();
    expect(waitForChange).toHaveBeenCalledWith(server.request, "change-1");
    await flush();
    expect(server.calls.filter((call) => call.path === "/api/v1/groups")).toHaveLength(2);
    expect(server.calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("pauses until a time from now, and Undo resumes", async () => {
    const { store, server } = setup({
      ...reads(() => childGroup()),
      "POST /api/v1/groups/group-child/rules/internet/pause": () => ({ json: {} }),
      "POST /api/v1/groups/group-child/rules/internet/resume": () => ({ json: {} }),
    });
    await store.reload();
    await applyGroupPause(store.mutate, childGroup(), { kind: "pauseFor", minutes: 30 }, "America/New_York", new Date("2026-09-28T16:00:00Z"));
    expect(server.calls.at(-1)?.body).toEqual({ until: "2026-09-28T16:30:00.000Z" });
    expect(store.getState().notice).toMatch(/^All internet blocked for A child until 12:30/);
    await store.runNoticeAction(store.getState().noticeAction!);
    expect(server.calls.at(-1)).toMatchObject({ method: "POST", path: "/api/v1/groups/group-child/rules/internet/resume" });
  });

  it("blocks more, unblocks, ends an unblock and pauses a rule for the group with the requests the API expects", async () => {
    const paused = childGroup({ access: "paused", suspension: { active: true, until: null, by: null } });
    const ok = () => ({ json: { group: paused } });
    const rule = (id: string) => () => ({ json: { rule: { id }, change: { changeId: `c-${id}` } } });
    const { store, server } = setup({
      ...reads(() => paused),
      "POST /api/v1/groups/group-child/rules/internet/extend": ok,
      "POST /api/v1/groups/group-child/unblock": ok,
      "POST /api/v1/groups/group-child/unblock/end": ok,
      "POST /api/v1/groups/group-child/unblock/extend": ok,
      "POST /api/v1/groups/group-child/rules/r1/pause": rule("r1"),
      "POST /api/v1/groups/group-child/rules/r2/pause": rule("r2"),
      "POST /api/v1/groups/group-child/rules/r1/resume": rule("r1"),
      "POST /api/v1/groups/group-child/rules/r1/extend": rule("r1"),
    });
    await store.reload();
    const now = new Date("2026-09-28T16:00:00Z");
    const tz = "America/New_York";
    await applyGroupPause(store.mutate, paused, { kind: "extend", minutes: 30 }, tz);
    await applyGroupSheet(store.mutate, paused, { kind: "unblock", mode: "pause" }, { kind: "current" }, tz, now);
    expect(store.getState().notice).toBe("A child unblocked until the block ends.");
    await applyGroupSheet(store.mutate, paused, { kind: "unblock", mode: "pause" }, { kind: "pauseFor", minutes: 60 }, tz, now);
    await applyGroupSheet(store.mutate, paused, { kind: "unblock", mode: "extend" }, { kind: "extend", minutes: 30 }, tz, now);
    await runGroupHeaderAction(store.mutate, paused, "resume");
    await runGroupHeaderAction(store.mutate, paused, "unblockNow");
    const zone = { kind: "rule" as const, ruleIds: ["r1", "r2"], name: "internet rules", mode: "pause" as const };
    await applyGroupSheet(store.mutate, paused, zone, { kind: "pauseUntil", until: null }, tz, now);
    expect(store.getState().notice).toBe("Internet rules paused for A child until you resume.");
    expect(store.getState().rules.map((item) => item.id)).toEqual(expect.arrayContaining(["r1", "r2"]));
    await applyGroupSheet(store.mutate, paused, { ...zone, ruleIds: ["r1"], mode: "extend" }, { kind: "extend", minutes: 15 }, tz, now);
    await resumeGroupRules(store.mutate, paused, ["r1"]);
    expect(server.calls.filter((call) => call.method === "POST").map((call) => [call.path.replace("/api/v1/groups/group-child/", ""), call.body])).toEqual([
      ["rules/internet/extend", { minutes: 30 }],
      ["unblock", {}],
      ["unblock", { until: "2026-09-28T17:00:00.000Z" }],
      ["unblock/extend", { minutes: 30 }],
      ["unblock/end", undefined],
      ["unblock", {}],
      ["rules/r1/pause", {}],
      ["rules/r2/pause", {}],
      ["rules/r1/extend", { minutes: 15 }],
      ["rules/r1/resume", undefined],
    ]);
  });

  it("adds, edits and deletes a group, and assigns a device, with the requests the API expects", async () => {
    const child = childGroup();
    const added = childGroup({ id: "group-new", name: "Consoles", kind: "things", familyRole: null, monogram: "CO" });
    const { store, server } = setup({
      ...reads(() => child),
      "POST /api/v1/groups": () => ({ json: { group: added, change: { changeId: "c1" } } }),
      "PUT /api/v1/groups/group-child": () => ({ json: { group: { ...child, name: "Sam" }, change: { changeId: "c2" } } }),
      "PUT /api/v1/devices/aa%3Abb/assignment": () => ({ json: { device: { mac: "aa:bb", groupId: "group-child" }, change: { changeId: "c3" } } }),
      "DELETE /api/v1/groups/group-child": () => ({ json: { change: { changeId: "c4" } } }),
    });
    await store.reload();
    await createGroup(store.mutate, { kind: "things", name: " Consoles ", familyRole: "child", monogram: "CO" });
    expect(store.getState().notice).toBe("Consoles added. Assign devices on the Devices page.");
    expect(store.getState().groups.map((group) => group.id)).toContain("group-new");
    // Nothing to send is not sent: an unchanged edit and an empty name.
    await expect(updateGroup(store.mutate, child, { name: child.name, familyRole: "child", monogram: "" })).resolves.toBeUndefined();
    await expect(createGroup(store.mutate, { kind: "family", name: "  ", familyRole: "child", monogram: "" })).resolves.toBeUndefined();
    await updateGroup(store.mutate, child, { name: "Sam", familyRole: "teen", monogram: "" });
    await assignDevice(store.mutate, { mac: "aa:bb" }, "group-child");
    // The page showing the group moves away while the group is still there, never drawing it as missing.
    let presentWhenDeleted: boolean | undefined;
    await deleteGroup(store.mutate, child, () => {
      presentWhenDeleted = store.getState().groups.some((group) => group.id === "group-child");
    });
    expect(presentWhenDeleted).toBe(true);
    expect(store.getState().groups.map((group) => group.id)).not.toContain("group-child");
    expect(server.calls.filter((call) => call.method !== "GET").map((call) => [call.method, call.path, call.body])).toEqual([
      ["POST", "/api/v1/groups", { kind: "things", name: "Consoles", familyRole: undefined, monogram: "CO" }],
      ["PUT", "/api/v1/groups/group-child", { name: "Sam", familyRole: "teen" }],
      ["PUT", "/api/v1/devices/aa%3Abb/assignment", { groupId: "group-child" }],
      ["DELETE", "/api/v1/groups/group-child", undefined],
    ]);
  });

  it("sends one delete for a group however often it is asked while the first is in flight", async () => {
    const child = childGroup();
    let finish: () => void = () => undefined;
    const { store, server } = setup({
      ...reads(() => child),
      "DELETE /api/v1/groups/group-child": () => new Promise((resolve) => (finish = () => resolve({ json: { change: { changeId: "c1" } } }))),
    });
    await store.reload();
    const first = deleteGroup(store.mutate, child);
    await expect(deleteGroup(store.mutate, child)).resolves.toBeUndefined();
    finish();
    await first;
    expect(server.calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
  });

  it("pauses a rule for every group it covers, with its own notice and Undo", async () => {
    const { store, server } = setup({
      ...reads(() => childGroup()),
      "POST /api/v1/rules/rule-bedtime/pause": () => ({ json: { rule: { ...bedtime, name: "Bedtime" } } }),
      "POST /api/v1/rules/rule-bedtime/extend": () => ({ json: {} }),
    });
    await store.reload();
    await applyRulePause(store.mutate, bedtime, { kind: "pauseUntil", until: null }, "America/New_York");
    expect(store.getState().notice).toBe("Bedtime paused until you resume.");
    await applyRulePause(store.mutate, bedtime, { kind: "extend", minutes: 60 }, "America/New_York");
    expect(server.calls.filter((call) => call.method === "POST").map((call) => [call.path, call.body])).toEqual([
      ["/api/v1/rules/rule-bedtime/pause", {}],
      ["/api/v1/rules/rule-bedtime/extend", { minutes: 60 }],
    ]);
  });

  it("keeps the quarantine rule's switch and the household's quarantine setting in step", async () => {
    const quarantine = { ...bedtime, id: "quarantine", name: "Quarantine", groupIds: [], builtIn: "quarantine" as const, enabled: true };
    const pausedQuarantine = { ...quarantine, pause: { active: true, until: null, kind: "pause" as const, by: null } };
    const household = { timezone: "America/New_York", revision: 1, displayName: "A household", quarantineEnforced: true };
    const { store } = setup({
      ...reads(() => childGroup()),
      "GET /api/v1/rules": () => ({ json: { rules: [pausedQuarantine, bedtime] } }),
      "GET /api/v1/settings/household": () => ({ json: { household } }),
      "PATCH /api/v1/rules/quarantine": () => ({ json: { rule: { ...quarantine, enabled: false } } }),
      "PUT /api/v1/settings/household": () => ({ json: { household: { ...household, quarantineEnforced: false } } }),
    });
    await store.reload();
    await store.mutate((send) => send("/api/v1/rules/quarantine", { method: "PATCH", body: { enabled: false } }));
    expect(store.getState().household?.quarantineEnforced).toBe(false);

    await store.reload();
    await store.mutate((send) => send("/api/v1/settings/household", { method: "PUT", body: { quarantineEnforced: false } }));
    const rule = store.getState().rules.find((item) => item.id === "quarantine");
    expect([rule?.enabled, rule?.pause.active]).toEqual([false, false]);
    expect(store.getState().rules.find((item) => item.id === bedtime.id)).toEqual(bedtime);
  });

  it("merges a returned account and UniFi settings", async () => {
    const { store } = setup({
      ...reads(() => childGroup()),
      "PUT /api/v1/accounts/account-2": () => ({ json: { account: { id: "account-2", displayName: "Another adult" }, unifi: { configured: false } } }),
    });
    await store.reload();
    await store.mutate((send) => send("/api/v1/accounts/account-2", { method: "PUT", body: {} }));
    expect(store.getState().accounts.map((account) => account.id)).toEqual(["account-1", "account-2"]);
    expect(store.getState().unifi).toEqual({ configured: false });
  });

  it("ignores a second write for a group while its first is in flight, and sends nothing", async () => {
    let release: () => void = () => {};
    const { store, server } = setup({
      ...reads(() => childGroup()),
      "POST /api/v1/groups/group-child/unblock/end": () =>
        new Promise((resolve) => {
          release = () => resolve({ json: {} });
        }),
    });
    await store.reload();
    const first = runGroupHeaderAction(store.mutate, childGroup(), "resume");
    await expect(runGroupHeaderAction(store.mutate, childGroup(), "unblockNow")).resolves.toBeUndefined();
    release();
    await first;
    expect(server.calls.filter((call) => call.method === "POST").map((call) => call.path.split("/").pop())).toEqual(["end"]);
  });

  it("rolls the optimistic change back and shows the server's error", async () => {
    const { store } = setup({
      ...reads(() => childGroup()),
      "POST /api/v1/groups/group-child/rules/internet/allow": () => ({ status: 409, json: { error: { code: "not_in_window", message: "No internet window is blocking right now." } } }),
    });
    await store.reload();
    await store.mutate((send) => send("/api/v1/groups/group-child/rules/internet/allow", { method: "POST", body: {} }), {
      optimistic: (lists) => ({ ...lists, groups: lists.groups.map((group) => ({ ...group, access: "allowed" as const })) }),
    });
    expect(store.getState().groups[0]?.access).toBe("available");
    expect(store.getState().error).toBe("No internet window is blocking right now.");
  });

  it("reports a failed change from the gateway", async () => {
    const { store } = setup(
      { ...reads(() => childGroup()), "POST /api/v1/groups/group-child/unblock/end": () => ({ json: { change: { changeId: "c" } } }) },
      { outcome: { status: "failed", error: "The gateway refused the policy." } },
    );
    await store.reload();
    await runGroupHeaderAction(store.mutate, childGroup(), "resume");
    await flush();
    expect(store.getState().error).toBe("The gateway refused the policy.");
  });

  it("drops a slower, older write's result in favour of a newer one", async () => {
    let releaseFirst: () => void = () => {};
    const { store } = setup({
      ...reads(() => childGroup()),
      "POST /api/v1/groups/a/rules/internet/resume": () =>
        new Promise((resolve) => {
          releaseFirst = () => resolve({ json: { group: childGroup({ access: "paused" }) } });
        }),
      "POST /api/v1/groups/b/rules/internet/resume": () => ({ json: { group: childGroup({ access: "available" }) } }),
    });
    await store.reload();
    const first = store.mutate((send) => send("/api/v1/groups/a/rules/internet/resume", { method: "POST" }));
    await flush();
    await store.mutate((send) => send("/api/v1/groups/b/rules/internet/resume", { method: "POST" }));
    releaseFirst();
    await first;
    expect(store.getState().groups[0]?.access).toBe("available");
  });

  it("reports an older write's failure after a newer one took over, and reads the truth once both end", async () => {
    let failFirst: () => void = () => {};
    const { store, server } = setup({
      ...reads(() => childGroup()),
      "POST /api/v1/groups/a/rules/internet/pause": () =>
        new Promise((resolve) => {
          failFirst = () => resolve({ status: 409, json: { error: { message: "The first write was refused." } } });
        }),
      "POST /api/v1/groups/b/rules/internet/pause": () => ({ json: {} }),
    });
    await store.reload();
    const paused = (lists: { groups: Group[]; devices: [] }) => ({ ...lists, groups: lists.groups.map((group) => ({ ...group, access: "paused" as const })) });
    const first = store.mutate((send) => send("/api/v1/groups/a/rules/internet/pause", { method: "POST" }), { optimistic: paused as never });
    await flush();
    await store.mutate((send) => send("/api/v1/groups/b/rules/internet/pause", { method: "POST" }));
    const loadsBefore = server.calls.filter((call) => call.path === "/api/v1/auth/session").length;
    failFirst();
    await first;
    expect(store.getState().error).toBe("The first write was refused.");
    await flush();
    await flush();
    expect(server.calls.filter((call) => call.path === "/api/v1/auth/session")).toHaveLength(loadsBefore + 1);
    expect(store.getState().groups[0]?.access).toBe("available");
  });

  it("reads the truth once overlapping writes end, so an older write's result is not lost", async () => {
    let current = childGroup();
    let releaseFirst: () => void = () => {};
    const { store, server } = setup({
      ...reads(() => current),
      "POST /api/v1/groups/a/rules/internet/pause": () =>
        new Promise((resolve) => {
          releaseFirst = () => {
            current = childGroup({ access: "paused" });
            resolve({ json: {} });
          };
        }),
      "POST /api/v1/groups/b/rules/internet/resume": () => ({ json: {} }),
    });
    await store.reload();
    const first = store.mutate((send) => send("/api/v1/groups/a/rules/internet/pause", { method: "POST" }));
    await flush();
    await store.mutate((send) => send("/api/v1/groups/b/rules/internet/resume", { method: "POST" }));
    const loadsBefore = server.calls.filter((call) => call.path === "/api/v1/auth/session").length;
    releaseFirst();
    await first;
    await flush();
    await flush();
    expect(server.calls.filter((call) => call.path === "/api/v1/auth/session")).toHaveLength(loadsBefore + 1);
    expect(store.getState().groups[0]?.access).toBe("paused");
  });

  it("reports a change the gateway refused even after a newer write", async () => {
    let refuse: (outcome: { status: string; error: string | null }) => void = () => {};
    const server = fakeServer({
      ...reads(() => childGroup()),
      "POST /api/v1/groups/a/rules/internet/pause": () => ({ json: { change: { changeId: "change-a" } } }),
      "POST /api/v1/groups/b/rules/internet/pause": () => ({ json: {} }),
    });
    const waitForChange = vi.fn(
      (_send: ApiRequest, id: string) =>
        id === "change-a" ? new Promise<{ status: string; error: string | null }>((resolve) => (refuse = resolve)) : Promise.resolve({ status: "applied", error: null }),
    );
    const store = createHouseholdStore({ request: server.request, waitForChange: waitForChange as never });
    await store.reload();
    await store.mutate((send) => send("/api/v1/groups/a/rules/internet/pause", { method: "POST" }));
    await store.mutate((send) => send("/api/v1/groups/b/rules/internet/pause", { method: "POST" }));
    refuse({ status: "failed", error: "The gateway refused the first change." });
    await flush();
    expect(store.getState().error).toBe("The gateway refused the first change.");
  });

  it("keeps a write's optimistic change when a refresh that started before it comes back", async () => {
    let answerRefresh: () => void = () => {};
    let slow = false;
    const routes = reads(() => childGroup());
    const { store } = setup({
      ...routes,
      "GET /api/v1/groups": (body) =>
        slow
          ? new Promise((resolve) => {
              answerRefresh = () => resolve({ json: { groups: [childGroup()] } });
            })
          : routes["GET /api/v1/groups"]!(body),
      "POST /api/v1/groups/group-child/rules/internet/pause": () => new Promise(() => {}),
    });
    await store.reload();
    slow = true;
    const stop = store.startRefreshing(60_000, 60_000);
    await flush();
    void store.mutate((send) => send("/api/v1/groups/group-child/rules/internet/pause", { method: "POST" }), {
      optimistic: (lists) => ({ ...lists, groups: lists.groups.map((group) => ({ ...group, access: "paused" as const })) }),
    });
    answerRefresh();
    await flush();
    stop();
    expect(store.getState().groups[0]?.access).toBe("paused");
  });

  it("dismisses a notice after 6 s, or 12 s with an Undo, and keeps an error", async () => {
    vi.useFakeTimers();
    const { store } = setup({ ...reads(() => childGroup()), "POST /api/v1/groups/group-child/rules/internet/pause": () => ({ json: {} }) });
    await store.reload();
    await store.mutate(async () => ({}));
    expect(store.getState().notice).toBe("Saved.");
    vi.advanceTimersByTime(NOTICE_MS);
    expect(store.getState().notice).toBe("");

    await applyGroupPause(store.mutate, childGroup(), { kind: "pauseUntil", until: null }, "America/New_York");
    vi.advanceTimersByTime(NOTICE_MS);
    expect(store.getState().noticeAction?.label).toBe("Undo");
    vi.advanceTimersByTime(NOTICE_WITH_ACTION_MS - NOTICE_MS);
    expect(store.getState()).toMatchObject({ notice: "", noticeAction: null });

    await store.mutate(async () => Promise.reject(new Error("Nope.")));
    vi.advanceTimersByTime(NOTICE_WITH_ACTION_MS);
    expect(store.getState().error).toBe("Nope.");
  });

  it("refreshes on a timer until stopped", async () => {
    vi.useFakeTimers();
    const { store, server } = setup(reads(() => childGroup()));
    const stop = store.startRefreshing(1000, 2000);
    await vi.advanceTimersByTimeAsync(2500);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    // A full load at 0 and again at 2000 when it falls due; the tick between rereads what changes on its own.
    expect(server.calls.filter((call) => call.path === "/api/v1/auth/session")).toHaveLength(2);
    expect(server.calls.filter((call) => call.path === "/api/v1/groups")).toHaveLength(3);
  });

  it("rereads only what changes on its own between full loads", async () => {
    vi.useFakeTimers();
    const { store, server } = setup(reads(() => childGroup()));
    const stop = store.startRefreshing(1000, 60_000);
    await vi.advanceTimersByTimeAsync(10);
    const afterLoad = server.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    stop();
    expect(server.calls.slice(afterLoad).map((call) => call.path).sort()).toEqual([
      "/api/v1/devices",
      "/api/v1/groups",
      "/api/v1/rules",
      "/api/v1/sync",
    ]);
  });

  it("keeps the same state and references, and tells no one, when a refresh brings nothing new", async () => {
    const { store } = setup(reads(() => childGroup()));
    await store.reload();
    const before = store.getState();
    const listener = vi.fn();
    store.subscribe(listener);
    await store.reload();
    expect(listener).not.toHaveBeenCalled();
    expect(store.getState()).toBe(before);
    expect(store.getState().groups).toBe(before.groups);
    expect(store.getState().rules).toBe(before.rules);
  });

  it("replaces only what changed, keeping the references of the rest", async () => {
    let paused = false;
    const { store } = setup({
      ...reads(() => childGroup({ access: paused ? "paused" : "available" })),
      "GET /api/v1/devices": () => ({ json: { devices: [{ id: "device-1", name: "A tablet" }] } }),
    });
    await store.reload();
    const before = store.getState();
    const listener = vi.fn();
    store.subscribe(listener);
    paused = true;
    await store.reload();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().groups).not.toBe(before.groups);
    expect(store.getState().groups[0]?.access).toBe("paused");
    expect(store.getState().groups[0]?.suspension).toBe(before.groups[0]?.suspension);
    expect(store.getState().devices).toBe(before.devices);
    expect(store.getState().accounts).toBe(before.accounts);
  });

  it("sends nothing while hidden, and catches up as soon as it is shown", async () => {
    vi.useFakeTimers();
    let hidden = false;
    let onChange = () => {};
    const unsubscribe = vi.fn();
    const server = fakeServer(reads(() => childGroup()));
    const store = createHouseholdStore({
      request: server.request,
      visibility: { hidden: () => hidden, subscribe: (callback) => ((onChange = callback), unsubscribe) },
    });
    const stop = store.startRefreshing(1000, 60_000);
    await vi.advanceTimersByTimeAsync(10);
    const loaded = server.calls.length;

    hidden = true;
    onChange();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.calls).toHaveLength(loaded);

    hidden = false;
    onChange();
    await vi.advanceTimersByTimeAsync(10);
    // Shown again, it refreshes at once what the timer would have, and no more.
    const caught = server.calls.slice(loaded).map((call) => call.path);
    expect(caught).toContain("/api/v1/groups");
    expect(caught).not.toContain("/api/v1/auth/session");
    stop();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("asks for the session alongside the rest, not before it", async () => {
    const routes = reads(() => childGroup());
    const { store, server } = setup({ ...routes, "GET /api/v1/auth/session": () => new Promise<Reply>(() => {}) });
    void store.reload();
    await Promise.resolve();
    expect(server.calls.map((call) => call.path)).toEqual(expect.arrayContaining(["/api/v1/auth/session", "/api/v1/groups", "/api/v1/accounts"]));
  });

  it("sends nothing when shown again soon after a refresh finished", async () => {
    vi.useFakeTimers();
    let hidden = false;
    let onChange = () => {};
    const server = fakeServer(reads(() => childGroup()));
    const store = createHouseholdStore({
      request: server.request,
      visibility: { hidden: () => hidden, subscribe: (callback) => ((onChange = callback), () => {}) },
    });
    const stop = store.startRefreshing(1000, 60_000);
    await vi.advanceTimersByTimeAsync(10);
    const loaded = server.calls.length;
    hidden = true;
    onChange();
    await vi.advanceTimersByTimeAsync(300);
    hidden = false;
    onChange();
    await vi.advanceTimersByTimeAsync(10);
    stop();
    expect(server.calls).toHaveLength(loaded);
  });

  it("counts a refresh on showing the tab, so a quick second return sends nothing", async () => {
    vi.useFakeTimers();
    let hidden = false;
    let onChange = () => {};
    const server = fakeServer(reads(() => childGroup()));
    const store = createHouseholdStore({
      request: server.request,
      visibility: { hidden: () => hidden, subscribe: (callback) => ((onChange = callback), () => {}) },
    });
    const stop = store.startRefreshing(1000, 60_000);
    await vi.advanceTimersByTimeAsync(10);
    const loaded = server.calls.length;
    hidden = true;
    onChange();
    await vi.advanceTimersByTimeAsync(5000);
    hidden = false;
    onChange();
    await vi.advanceTimersByTimeAsync(10);
    const returned = server.calls.length;
    expect(returned).toBeGreaterThan(loaded);
    hidden = true;
    onChange();
    await vi.advanceTimersByTimeAsync(100);
    hidden = false;
    onChange();
    await vi.advanceTimersByTimeAsync(10);
    stop();
    expect(server.calls).toHaveLength(returned);
  });

  it("sends nothing more when shown again while a tick is still waiting on the server", async () => {
    vi.useFakeTimers();
    let hidden = false;
    let onChange = () => {};
    let slow = false;
    const routes = reads(() => childGroup());
    const server = fakeServer({ ...routes, "GET /api/v1/sync": () => (slow ? new Promise<Reply>(() => {}) : routes["GET /api/v1/sync"]!(undefined)) });
    const store = createHouseholdStore({
      request: server.request,
      visibility: { hidden: () => hidden, subscribe: (callback) => ((onChange = callback), () => {}) },
    });
    const stop = store.startRefreshing(1000, 60_000);
    await vi.advanceTimersByTimeAsync(10);
    slow = true;
    await vi.advanceTimersByTimeAsync(1000);
    hidden = true;
    onChange();
    hidden = false;
    const sent = server.calls.length;
    onChange();
    await vi.advanceTimersByTimeAsync(10);
    stop();
    expect(server.calls).toHaveLength(sent);
  });

  it("reloads in full on the next tick after a refresh failed", async () => {
    vi.useFakeTimers();
    let fail = false;
    const routes = reads(() => childGroup());
    const { store, server } = setup({ ...routes, "GET /api/v1/sync": () => (fail ? { status: 500, json: { error: { message: "Down." } } } : routes["GET /api/v1/sync"]!(undefined)) });
    const stop = store.startRefreshing(1000, 60_000);
    await vi.advanceTimersByTimeAsync(10);
    fail = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getState().stale).toBe(true);
    fail = false;
    const sessions = server.calls.filter((call) => call.path === "/api/v1/auth/session").length;
    await vi.advanceTimersByTimeAsync(1000);
    stop();
    expect(server.calls.filter((call) => call.path === "/api/v1/auth/session")).toHaveLength(sessions + 1);
    expect(store.getState().stale).toBe(false);
  });

  it("does not stack a refresh behind one still waiting on the server", async () => {
    vi.useFakeTimers();
    let release = () => {};
    const routes = reads(() => childGroup());
    const { store, server } = setup({
      ...routes,
      "GET /api/v1/auth/session": () => new Promise<Reply>((resolve) => (release = () => resolve(routes["GET /api/v1/auth/session"]!(undefined) as Reply))),
    });
    const stop = store.startRefreshing(1000, 60_000);
    await vi.advanceTimersByTimeAsync(5000);
    // The first load's reads, all sent at once, and nothing after them while the session waits.
    expect(server.calls.filter((call) => call.path === "/api/v1/auth/session")).toHaveLength(1);
    expect(server.calls).toHaveLength(8);
    release();
    await vi.advanceTimersByTimeAsync(10);
    stop();
    expect(store.getState().status).toBe("ready");
  });
});

describe("household store on the web (no offline guard)", () => {
  it("says why the first load failed, and keeps the page when a later refresh fails", async () => {
    let fail = true;
    const routes = reads(() => childGroup());
    const { store } = setup({ ...routes, "GET /api/v1/groups": () => (fail ? { status: 500, json: { error: { message: "Database unavailable." } } } : routes["GET /api/v1/groups"]!(undefined)) });
    await store.reload();
    expect(store.getState()).toMatchObject({ loaded: true, status: "loading", error: "Database unavailable." });

    fail = false;
    store.dismissFeedback();
    await store.reload();
    fail = true;
    await store.reload();
    expect(store.getState()).toMatchObject({ status: "ready", error: "" });
    expect(store.getState().groups).toHaveLength(1);
    // A stale web page still sends writes; the server decides.
    expect(store.canControl()).toBe(true);
  });

  it("reports a refused session as signed out, without an error to show", async () => {
    const { store } = setup({ ...reads(() => childGroup()), "GET /api/v1/auth/session": () => ({ status: 401, json: { error: { message: "Sign in." } } }) });
    await store.reload();
    expect(store.getState()).toMatchObject({ status: "signedOut", error: "" });
  });
});

describe("household store with an offline guard (a phone)", () => {
  it("goes stale when a refresh fails, and then never sends or queues a write", async () => {
    let reachable = true;
    const routes = reads(() => childGroup());
    const { store, server } = setup(
      {
        ...routes,
        "GET /api/v1/groups": () => (reachable ? routes["GET /api/v1/groups"]!(undefined) : offline()),
        "POST /api/v1/groups/group-child/rules/internet/resume": () => ({ json: {} }),
      },
      { offlineGuard: GUARD },
    );
    await store.reload();
    reachable = false;
    await store.reload();
    expect(store.getState()).toMatchObject({ stale: true, unreachable: true, error: GUARD.stale });
    expect(store.getState().groups).toHaveLength(1);
    expect(store.canControl()).toBe(false);

    await expect(runGroupHeaderAction(store.mutate, childGroup(), "resume")).resolves.toBeUndefined();
    expect(store.getState().error).toBe(GUARD.notSent);
    expect(server.calls.some((call) => call.method === "POST")).toBe(false);

    // Coming back does not replay the refused tap, and answers the "not sent" message.
    reachable = true;
    await store.reload();
    expect(store.getState()).toMatchObject({ stale: false, unreachable: false, error: "" });
    expect(store.canControl()).toBe(true);
    expect(server.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("tells a refused refresh from one that reached nothing", async () => {
    const routes = reads(() => childGroup());
    const { store } = setup(
      { ...routes, "GET /api/v1/groups": () => Promise.reject(new ApiError("Server error.", 500, "internal")) as never },
      { offlineGuard: GUARD },
    );
    await store.reload();
    expect(store.getState()).toMatchObject({ stale: true, unreachable: false });
  });

  it("says a write that lost its connection may not have been sent, and reads the truth", async () => {
    let reachable = true;
    const routes = reads(() => childGroup());
    const { store } = setup(
      {
        ...routes,
        "GET /api/v1/auth/session": () => (reachable ? routes["GET /api/v1/auth/session"]!(undefined) : offline()),
        "POST /api/v1/groups/group-child/unblock/end": offline,
      },
      { offlineGuard: GUARD },
    );
    await store.reload();
    reachable = false;
    await runGroupHeaderAction(store.mutate, childGroup(), "resume");
    await flush();
    expect(store.getState()).toMatchObject({ stale: true, error: GUARD.maybeNotSent });
  });

  it("turns controls off once signed out", async () => {
    const { store } = setup(
      { ...reads(() => childGroup()), "GET /api/v1/auth/session": () => ({ status: 401, json: { error: { message: "Sign in." } } }) },
      { offlineGuard: GUARD },
    );
    await store.reload();
    expect(store.getState().status).toBe("signedOut");
    expect(store.canControl()).toBe(false);
  });
});
