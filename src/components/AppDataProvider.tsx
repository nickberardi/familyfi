"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, api, waitForChange } from "@/lib/api";
import type { Account, Device, Group, Session, SyncStatus, UnifiSettings } from "@/lib/types";

type Household = {
  timezone: string;
  revision: number;
  quarantineEnforced: boolean;
  quarantineObservedEnabled: boolean | null;
  quarantinePolicyCount: number;
};

type AppData = {
  session: Session | null;
  groups: Group[];
  devices: Device[];
  sync: SyncStatus | null;
  unifi: UnifiSettings | null;
  household: Household | null;
  accounts: Account[];
  loading: boolean;
  error: string;
  notice: string;
  reload: () => Promise<void>;
  mutate: (run: () => Promise<{ change?: { changeId: string } }>) => Promise<void>;
  busy: boolean;
};

const Ctx = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [unifi, setUnifi] = useState<UnifiSettings | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    let sessionRes: { session: Session };
    try {
      sessionRes = await api<{ session: Session }>("/api/v1/auth/session");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && typeof window !== "undefined") {
        window.location.href = "/login";
      }
      throw err;
    }
    const [groupsRes, devicesRes, syncRes, unifiRes, householdRes, accountsRes] = await Promise.all([
      api<{ groups: Group[] }>("/api/v1/groups"),
      api<{ devices: Device[] }>("/api/v1/devices"),
      api<SyncStatus>("/api/v1/sync"),
      api<{ unifi: UnifiSettings }>("/api/v1/settings/unifi"),
      api<{ household: Household }>("/api/v1/settings/household"),
      api<{ accounts: Account[] }>("/api/v1/accounts"),
    ]);
    setSession(sessionRes.session);
    setGroups(groupsRes.groups);
    setDevices(devicesRes.devices);
    setSync(syncRes);
    setUnifi(unifiRes.unifi);
    setHousehold(householdRes.household);
    setAccounts(accountsRes.accounts);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const start = window.setTimeout(() => {
      reload()
        .catch((err: Error) => {
          if (cancelled) return;
          if (err instanceof ApiError && err.status === 401) return;
          setError(err.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);
    const timer = setInterval(() => {
      void reload().catch(() => undefined);
    }, 15_000);
    return () => {
      cancelled = true;
      window.clearTimeout(start);
      clearInterval(timer);
    };
  }, [reload]);

  const mutate = useCallback(
    async (run: () => Promise<{ change?: { changeId: string } }>) => {
      setError("");
      setNotice("");
      setBusy(true);
      try {
        const result = await run();
        if (result.change?.changeId) {
          const change = await waitForChange(result.change.changeId);
          if (change.status === "failed") setError(change.error ?? "That change did not apply.");
          else if (change.status === "partial") setNotice(change.error ?? "Reconcile finished with issues.");
          else if (change.status === "pending") setNotice(change.error ?? "Still applying.");
          else setNotice("Saved. The gateway has the current desired state.");
        }
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Request failed.");
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const value = useMemo(
    () => ({
      session,
      groups,
      devices,
      sync,
      unifi,
      household,
      accounts,
      loading,
      error,
      notice,
      reload,
      mutate,
      busy,
    }),
    [session, groups, devices, sync, unifi, household, accounts, loading, error, notice, reload, mutate, busy],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppData(): AppData {
  const value = useContext(Ctx);
  if (!value) throw new Error("useAppData must be used under AppDataProvider");
  return value;
}
