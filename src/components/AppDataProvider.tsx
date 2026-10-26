"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { request } from "@/lib/api";
import type { ApiRequest } from "@/lib/api-client";
import type { HouseholdLists, HouseholdPublic, MutationPayload } from "@/lib/household-state";
import { createHouseholdStore, type HouseholdStore, type NoticeAction, type Visibility } from "@/lib/household-store";
import type { Rule } from "@/lib/rules";
import type { Account, Device, Group, Session, SyncStatus, UnifiSettings } from "@/lib/types";

export type { NoticeAction };

type AppData = {
  session: Session | null;
  groups: Group[];
  devices: Device[];
  /** Every household rule. Cards read their internet windows and category schedules from it. */
  rules: Rule[];
  sync: SyncStatus | null;
  unifi: UnifiSettings | null;
  household: HouseholdPublic | null;
  accounts: Account[];
  /** The household has not loaded yet; pages wait for it rather than show it empty. */
  loading: boolean;
  /** The last refresh failed, so what is shown may be out of date. */
  stale: boolean;
  /** The server refused the session; the page is on its way to sign-in. */
  signedOut: boolean;
  error: string;
  notice: string;
  noticeAction: NoticeAction | null;
  reload: () => Promise<void>;
  mutate: (
    run: (request: ApiRequest) => Promise<unknown>,
    optimistic?: (state: HouseholdLists) => HouseholdLists,
    feedback?: { notice: string; action?: NoticeAction },
  ) => Promise<MutationPayload | undefined>;
  dismissFeedback: () => void;
  busy: boolean;
  /** The shared household store, for the shared writes in `src/lib/group-writes.ts`. */
  store: HouseholdStore;
};

const Ctx = createContext<AppData | null>(null);

/** A background tab stops refreshing the household, and catches up when it is shown again. */
const documentVisibility: Visibility = {
  hidden: () => document.visibilityState === "hidden",
  subscribe(onChange) {
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  },
};

/**
 * The household for every page: the shared store (`src/lib/household-store.ts`), which the native
 * app uses too, loaded on mount and refreshed while the tab is visible, with the browser's cookie session.
 */
export function AppDataProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [store] = useState(() => createHouseholdStore({ request, visibility: documentVisibility }));
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);

  useEffect(() => store.startRefreshing(), [store]);
  // The server refused the session: sign in again.
  useEffect(() => {
    if (state.status === "signedOut") router.replace("/login");
  }, [state.status, router]);

  const mutate = useCallback<AppData["mutate"]>(
    (run, optimistic, feedback) => store.mutate(run, { optimistic, feedback }),
    [store],
  );

  const value = useMemo<AppData>(
    () => ({
      session: state.session,
      groups: state.groups,
      devices: state.devices,
      rules: state.rules,
      sync: state.sync,
      unifi: state.unifi,
      household: state.household,
      accounts: state.accounts,
      // Until a load has worked, whether or not one has failed: an empty household isn't the household.
      loading: state.status !== "ready",
      stale: state.stale,
      signedOut: state.status === "signedOut",
      error: state.error,
      notice: state.notice,
      noticeAction: state.noticeAction,
      reload: store.reload,
      mutate,
      dismissFeedback: store.dismissFeedback,
      busy: state.busy,
      store,
    }),
    [state, store, mutate],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppData(): AppData {
  const value = useContext(Ctx);
  if (!value) throw new Error("useAppData must be used under AppDataProvider");
  return value;
}
