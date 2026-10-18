import { ApiError, TransportError, waitForChange as pollChange, type ApiRequest, type ChangeOutcome } from "./api-client";
import {
  applyMutationResult,
  asMutationPayload,
  type HouseholdLists,
  type HouseholdPublic,
  type MutationPayload,
} from "./household-state";
import { beginMutate, canCommitMutate, type MutateGate } from "./mutate-gate";
import type { Rule } from "./rules";
import { shareUnchanged } from "./structural-sharing";
import type { Account, Device, Group, Session, SyncStatus, UnifiSettings } from "./types";

/**
 * The household every client shows, and every write to it: parallel reads, an optimistic merge,
 * the server's result applied with `applyMutationResult`, then a background `waitForChange`, an
 * outcome notice and a reload. It is plain TypeScript, so each client wraps it in its own
 * framework (the web's `AppDataProvider`, the native app's provider) and it is unit-tested here.
 */

/** A notice that can take its change back, such as the Undo after a pause. */
export type NoticeAction = { label: string; run: (request: ApiRequest) => Promise<unknown> };

export type HouseholdState = {
  /** `signedOut` once the server refuses the session (401). */
  status: "loading" | "ready" | "signedOut";
  /** The first load has finished, whether or not it worked. */
  loaded: boolean;
  session: Session | null;
  groups: Group[];
  devices: Device[];
  /** Every household rule. Cards read their internet windows and category schedules from it. */
  rules: Rule[];
  sync: SyncStatus | null;
  unifi: UnifiSettings | null;
  household: HouseholdPublic | null;
  accounts: Account[];
  /** The last refresh failed, so what is shown may be out of date. */
  stale: boolean;
  /** The last refresh could not reach the server at all (no route answered), rather than being refused. */
  unreachable: boolean;
  error: string;
  notice: string;
  noticeAction: NoticeAction | null;
  /** A write is in flight. */
  busy: boolean;
  /** Groups with a write in flight; their controls wait for it. */
  busyGroupIds: readonly string[];
};

/**
 * A client that may lose its connection (a phone) turns its controls off while the view may be
 * out of date, and never sends or queues a write then. Its messages for that are its own copy.
 */
export type OfflineGuard = {
  /** Shown when a refresh fails: what is on screen may be out of date. */
  stale: string;
  /** Shown when a write is refused because the view is stale. */
  notSent: string;
  /** Shown when a write lost its connection, so whether it landed is unknown. */
  maybeNotSent: string;
};

/** A paired phone's wording: it can lose its connection, and never queues a change for later. */
export const COMPANION_OFFLINE_GUARD: OfflineGuard = {
  stale: "Can't reach FamilyFi — showing the last update. Controls are off until it's back.",
  notSent: "Can't reach FamilyFi — this change wasn't sent.",
  maybeNotSent: "Can't reach FamilyFi — this change may not have been sent.",
};

export type MutateOptions = {
  optimistic?: (state: HouseholdLists) => HouseholdLists;
  feedback?: { notice: string; action?: NoticeAction };
  /** The group the write is for: one write per group at a time. */
  groupId?: string;
};

/** How long a notice stays: long enough to use its Undo when it has one. Errors stay. */
export const NOTICE_MS = 6000;
export const NOTICE_WITH_ACTION_MS = 12_000;
/**
 * How often a client refreshes what changes most on its own while it is showing the household:
 * groups and rules (windows open and close, pauses end), devices and sync.
 */
export const REFRESH_MS = 15_000;
/**
 * How often it also rereads the rest: the session, settings and accounts, which change by a write
 * or, for the gateway's status and quarantine observation, at reconcile's pace.
 */
export const FULL_REFRESH_MS = 5 * 60_000;

/**
 * Whether the household is on screen. A client that is hidden (a background tab, a
 * backgrounded app) stops refreshing, and catches up the moment it is shown again.
 */
export type Visibility = {
  hidden(): boolean;
  /** Calls `onChange` whenever `hidden()` may have changed; returns the unsubscribe. */
  subscribe(onChange: () => void): () => void;
};

export type HouseholdStore = ReturnType<typeof createHouseholdStore>;

export function createHouseholdStore(deps: {
  request: ApiRequest;
  waitForChange?: (request: ApiRequest, changeId: string) => Promise<ChangeOutcome>;
  offlineGuard?: OfflineGuard;
  visibility?: Visibility;
}) {
  const { request, offlineGuard, visibility } = deps;
  const follow = deps.waitForChange ?? ((send: ApiRequest, id: string) => pollChange(send, id));
  const connectionMessages = new Set(offlineGuard ? [offlineGuard.stale, offlineGuard.notSent, offlineGuard.maybeNotSent] : []);
  let state: HouseholdState = {
    status: "loading",
    loaded: false,
    session: null,
    groups: [],
    devices: [],
    rules: [],
    sync: null,
    unifi: null,
    household: null,
    accounts: [],
    stale: false,
    unreachable: false,
    error: "",
    notice: "",
    noticeAction: null,
    busy: false,
    busyGroupIds: [],
  };
  const listeners = new Set<() => void>();
  const gate: MutateGate = { latest: 0 };
  let loadGen = 0;
  let followGen = 0;
  /** When the last full reload started, so the timer knows when the next is due. */
  let fullLoadAt = Number.NEGATIVE_INFINITY;
  let busyCount = 0;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;

  const set = (patch: Partial<HouseholdState>) => {
    // Nothing new: keep the state object, so no subscriber renders again.
    if ((Object.keys(patch) as (keyof HouseholdState)[]).every((key) => Object.is(state[key], patch[key]))) return;
    const before = state;
    state = { ...state, ...patch };
    if (state.notice !== before.notice || state.noticeAction !== before.noticeAction || state.error !== before.error) {
      scheduleNoticeDismissal();
    }
    for (const listener of listeners) listener();
  };

  function scheduleNoticeDismissal() {
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = null;
    if (!state.notice || state.error) return;
    noticeTimer = setTimeout(
      () => {
        noticeTimer = null;
        set({ notice: "", noticeAction: null });
      },
      state.noticeAction ? NOTICE_WITH_ACTION_MS : NOTICE_MS,
    );
  }

  const lists = (): HouseholdLists => ({ groups: state.groups, devices: state.devices });

  /** Whether a control may send a write now. */
  const canControl = () => !offlineGuard || (state.status === "ready" && !state.stale);

  /** Content the server sent again unchanged keeps the references already shown. */
  const shared = <K extends keyof HouseholdState>(key: K, next: HouseholdState[K]) => shareUnchanged(state[key], next);

  function failed(error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      set({ status: "signedOut", loaded: true, stale: true, unreachable: false });
      return;
    }
    if (offlineGuard) {
      // Keep what is shown, but say it may be out of date. A write's own failure message,
      // already shown, says more than this one, so it stays.
      set({ loaded: true, stale: true, unreachable: error instanceof TransportError, error: state.error || offlineGuard.stale });
    } else {
      // The first load says why it failed; a later refresh keeps the page as it is.
      set({ loaded: true, stale: true, unreachable: error instanceof TransportError, ...(state.loaded ? {} : { error: error instanceof Error ? error.message : "Request failed." }) });
    }
  }

  // Reaching the server again answers any message about not reaching it.
  const reached = () => ({ stale: false, unreachable: false, ...(connectionMessages.has(state.error) ? { error: "" } : {}) });

  async function reload(): Promise<void> {
    const gen = ++loadGen;
    fullLoadAt = Date.now();
    try {
      const { session } = await request<{ session: Session }>("/api/v1/auth/session");
      const [groups, devices, rules, sync, unifi, household, accounts] = await Promise.all([
        request<{ groups: Group[] }>("/api/v1/groups"),
        request<{ devices: Device[] }>("/api/v1/devices"),
        request<{ rules: Rule[] }>("/api/v1/rules"),
        request<SyncStatus>("/api/v1/sync"),
        request<{ unifi: UnifiSettings }>("/api/v1/settings/unifi"),
        request<{ household: HouseholdPublic }>("/api/v1/settings/household"),
        request<{ accounts: Account[] }>("/api/v1/accounts"),
      ]);
      if (gen !== loadGen) return;
      set({
        status: "ready",
        loaded: true,
        session: shared("session", session),
        groups: shared("groups", groups.groups),
        devices: shared("devices", devices.devices),
        rules: shared("rules", rules.rules),
        sync: shared("sync", sync),
        unifi: shared("unifi", unifi.unifi),
        household: shared("household", household.household),
        accounts: shared("accounts", accounts.accounts),
        ...reached(),
      });
    } catch (error) {
      if (gen !== loadGen) return;
      failed(error);
    }
  }

  /** Rereads only what changes without a write. A full reload or a write started meanwhile wins. */
  async function refreshLive(): Promise<void> {
    const gen = loadGen;
    try {
      const [groups, devices, rules, sync] = await Promise.all([
        request<{ groups: Group[] }>("/api/v1/groups"),
        request<{ devices: Device[] }>("/api/v1/devices"),
        request<{ rules: Rule[] }>("/api/v1/rules"),
        request<SyncStatus>("/api/v1/sync"),
      ]);
      if (gen !== loadGen) return;
      set({
        groups: shared("groups", groups.groups),
        devices: shared("devices", devices.devices),
        rules: shared("rules", rules.rules),
        sync: shared("sync", sync),
        ...reached(),
      });
    } catch (error) {
      if (gen !== loadGen) return;
      failed(error);
    }
  }

  async function mutate(run: (request: ApiRequest) => Promise<unknown>, options: MutateOptions = {}): Promise<MutationPayload | undefined> {
    const { optimistic, feedback, groupId } = options;
    // Never send, or queue, a write from a view that may be out of date.
    if (offlineGuard && !canControl()) {
      set({ error: offlineGuard.notSent, notice: "", noticeAction: null });
      return undefined;
    }
    if (groupId && state.busyGroupIds.includes(groupId)) return undefined;
    const previous = lists();
    const token = beginMutate(gate);
    busyCount += 1;
    set({
      error: "",
      notice: "",
      noticeAction: null,
      busy: true,
      busyGroupIds: groupId ? [...state.busyGroupIds, groupId] : state.busyGroupIds,
    });
    try {
      if (optimistic) {
        const next = optimistic(previous);
        set({ groups: next.groups, devices: next.devices });
      }
      const result = asMutationPayload(await run(request));
      if (!canCommitMutate(gate, token)) return result;
      loadGen += 1;
      followGen += 1;
      const followToken = followGen;
      const next = applyMutationResult(lists(), result);
      let rules = state.rules;
      if (result.rule) rules = upsertBy(rules, result.rule, (rule) => rule.id);
      for (const rule of result.rules ?? []) rules = upsertBy(rules, rule, (item) => item.id);
      if (result.removedRuleId) rules = rules.filter((rule) => rule.id !== result.removedRuleId);
      // The built-in quarantine rule's switch is the household's quarantine setting: keep both in step.
      let household = result.household ?? state.household;
      if (result.rule?.builtIn === "quarantine" && household) household = { ...household, quarantineEnforced: result.rule.enabled };
      if (result.household) {
        const enforced = result.household.quarantineEnforced;
        rules = rules.map((rule) =>
          rule.builtIn !== "quarantine" ? rule : { ...rule, enabled: enforced, pause: enforced ? rule.pause : { active: false, until: null, kind: "pause", by: null } },
        );
      }
      set({
        groups: next.groups,
        devices: next.devices,
        rules,
        household,
        ...(result.unifi ? { unifi: result.unifi } : {}),
        ...(result.account ? { accounts: upsertBy(state.accounts, result.account, (account) => account.id) } : {}),
        notice: feedback?.notice ?? "Saved.",
        noticeAction: feedback?.action ?? null,
      });
      if (result.change?.changeId) {
        void follow(request, result.change.changeId)
          .then(async (change) => {
            if (followToken !== followGen) return;
            if (change.status === "failed") set({ error: change.error ?? "That change did not apply." });
            else if (change.status === "partial") set({ notice: change.error ?? "Reconcile finished with issues." });
            else if (change.status === "pending") set({ notice: change.error ?? "Still applying." });
            // Keep the change's own notice, and its Undo, once the gateway has it.
            else if (feedback) set({ error: "" });
            else set({ error: "", notice: "Saved. The gateway has the current desired state." });
            await reload();
          })
          .catch(async (error: unknown) => {
            if (followToken !== followGen) return;
            // Desired state is already saved; the gateway follow-up is only a soft warning.
            set({ error: "", notice: `Saved. Sync follow-up: ${error instanceof Error ? error.message : String(error)}` });
            await reload();
          });
      }
      return result;
    } catch (error) {
      if (canCommitMutate(gate, token)) {
        const lostConnection = offlineGuard && error instanceof TransportError;
        set({
          groups: previous.groups,
          devices: previous.devices,
          error: lostConnection ? offlineGuard.maybeNotSent : error instanceof Error ? error.message : "Request failed.",
        });
        // Whether a write that lost its connection landed is unknown: read the truth, never retry it.
        if (lostConnection) void reload();
      }
      return undefined;
    } finally {
      busyCount = Math.max(0, busyCount - 1);
      set({
        busy: busyCount > 0,
        ...(groupId ? { busyGroupIds: state.busyGroupIds.filter((id) => id !== groupId) } : {}),
      });
    }
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Whether a control may send a write now: always, unless an offline guard says the view is stale. */
    canControl,
    reload,
    mutate,
    dismissFeedback: () => set({ error: "", notice: "", noticeAction: null }),
    /** Runs a notice's action (such as Undo) as a write of its own. */
    runNoticeAction: (action: NoticeAction) => mutate(action.run),
    /**
     * Loads now, then every `interval` refreshes what changes on its own, with a full reload
     * every `fullInterval` (or whenever the view is stale), until the returned function stops
     * it. While hidden it sends nothing, and reloads in full as soon as it is shown again.
     */
    startRefreshing(interval = REFRESH_MS, fullInterval = FULL_REFRESH_MS): () => void {
      // One refresh at a time: a slow server gets no second request stacked behind the first.
      let inFlight = false;
      const run = async (load: () => Promise<void>) => {
        if (inFlight) return;
        inFlight = true;
        try {
          await load();
        } finally {
          inFlight = false;
        }
      };
      const tick = () => {
        if (visibility?.hidden()) return;
        const full = !state.loaded || state.stale || Date.now() - fullLoadAt >= fullInterval;
        void run(full ? reload : refreshLive);
      };
      void run(reload);
      const timer = setInterval(tick, interval);
      // Shown again: everything, even past a tick still in flight, which the reload supersedes.
      const unsubscribe = visibility?.subscribe(() => {
        if (!visibility.hidden()) void reload();
      });
      return () => {
        clearInterval(timer);
        unsubscribe?.();
      };
    },
  };
}

function upsertBy<T>(items: T[], item: T, key: (item: T) => string): T[] {
  const index = items.findIndex((other) => key(other) === key(item));
  if (index === -1) return [...items, item];
  const next = items.slice();
  next[index] = item;
  return next;
}
