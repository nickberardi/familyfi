"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { request } from "@/lib/api";
import type { ApiRequest } from "@/lib/api-client";
import type { HouseholdLists, HouseholdPublic, MutationPayload } from "@/lib/household-state";
import { createHouseholdStore, type HouseholdStore, type NoticeAction } from "@/lib/household-store";
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
  loading: boolean;
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

/**
 * The household for every page: the shared store (`src/lib/household-store.ts`), which the native
 * app uses too, loaded on mount and refreshed every 15 seconds, with the browser's cookie session.
 */
export function AppDataProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [store] = useState(() => createHouseholdStore({ request }));
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
      loading: !state.loaded,
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
