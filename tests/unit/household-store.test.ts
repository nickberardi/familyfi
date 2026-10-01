/**
 * The shared household store (`src/lib/household-store.ts`) and writes (`src/lib/group-writes.ts`)
 * against a fake server: the mutate flow (optimistic merge, server result, change polling,
 * reload), the web's default refresh handling, and the offline guard a phone uses, under which a
 * stale view never sends or queues a write.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, TransportError, type ApiRequest } from "@/lib/api-client";
import { applyGroupPause, applyRulePause, assignDevice, createGroup, deleteGroup, runGroupAction, updateGroup } from "@/lib/group-writes";
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
    await expect(runGroupAction(store.mutate, current, "resume")).resolves.toBeUndefined();
    await pending;
    const state = store.getState();
    expect(state.groups[0]?.access).toBe("paused");
    expect(state.notice).toBe("All internet paused for A child until you resume.");
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
    expect(store.getState().notice).toMatch(/^All internet paused for A child until 12:30/);
    await store.runNoticeAction(store.getState().noticeAction!);
    expect(server.calls.at(-1)).toMatchObject({ method: "POST", path: "/api/v1/groups/group-child/rules/internet/resume" });
  });

  it("extends, resumes, allows and disallows with the requests the API expects", async () => {
    const paused = childGroup({ access: "paused", suspension: { active: true, until: null, by: null } });
    const ok = () => ({ json: { group: paused } });
    const { store, server } = setup({
      ...reads(() => paused),
      "POST /api/v1/groups/group-child/rules/internet/extend": ok,
      "POST /api/v1/groups/group-child/rules/internet/resume": ok,
      "POST /api/v1/groups/group-child/rules/internet/allow": ok,
      "POST /api/v1/groups/group-child/rules/internet/disallow": ok,
    });
    await store.reload();
    await applyGroupPause(store.mutate, paused, { kind: "extend", minutes: 30 }, "America/New_York");
    await runGroupAction(store.mutate, paused, "resume");
    await runGroupAction(store.mutate, paused, "allow");
    await runGroupAction(store.mutate, paused, "disallow");
    expect(server.calls.filter((call) => call.method === "POST").map((call) => [call.path.split("/").pop(), call.body])).toEqual([
      ["extend", { minutes: 30 }],
      ["resume", undefined],
      ["allow", {}],
      ["disallow", undefined],
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
      "POST /api/v1/groups/group-child/rules/internet/resume": () =>
        new Promise((resolve) => {
          release = () => resolve({ json: {} });
        }),
    });
    await store.reload();
    const first = runGroupAction(store.mutate, childGroup(), "resume");
    await expect(runGroupAction(store.mutate, childGroup(), "allow")).resolves.toBeUndefined();
    release();
    await first;
    expect(server.calls.filter((call) => call.method === "POST").map((call) => call.path.split("/").pop())).toEqual(["resume"]);
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
      { ...reads(() => childGroup()), "POST /api/v1/groups/group-child/rules/internet/resume": () => ({ json: { change: { changeId: "c" } } }) },
      { outcome: { status: "failed", error: "The gateway refused the policy." } },
    );
    await store.reload();
    await runGroupAction(store.mutate, childGroup(), "resume");
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
    const stop = store.startRefreshing(1000);
    await vi.advanceTimersByTimeAsync(2500);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(server.calls.filter((call) => call.path === "/api/v1/auth/session")).toHaveLength(3);
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
    expect(store.getState()).toMatchObject({ stale: true, error: GUARD.stale });
    expect(store.getState().groups).toHaveLength(1);
    expect(store.canControl()).toBe(false);

    await expect(runGroupAction(store.mutate, childGroup(), "resume")).resolves.toBeUndefined();
    expect(store.getState().error).toBe(GUARD.notSent);
    expect(server.calls.some((call) => call.method === "POST")).toBe(false);

    // Coming back does not replay the refused tap, and answers the "not sent" message.
    reachable = true;
    await store.reload();
    expect(store.getState()).toMatchObject({ stale: false, error: "" });
    expect(store.canControl()).toBe(true);
    expect(server.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("says a write that lost its connection may not have been sent, and reads the truth", async () => {
    let reachable = true;
    const routes = reads(() => childGroup());
    const { store } = setup(
      {
        ...routes,
        "GET /api/v1/auth/session": () => (reachable ? routes["GET /api/v1/auth/session"]!(undefined) : offline()),
        "POST /api/v1/groups/group-child/rules/internet/resume": offline,
      },
      { offlineGuard: GUARD },
    );
    await store.reload();
    reachable = false;
    await runGroupAction(store.mutate, childGroup(), "resume");
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
