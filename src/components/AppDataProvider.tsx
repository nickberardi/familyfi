"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { flushSync } from "react-dom";
import { ApiError, api, waitForChange } from "@/lib/api";
import {
  applyMutationResult,
  asMutationPayload,
  type HouseholdLists,
  type HouseholdPublic,
  type MutationPayload,
} from "@/lib/household-state";
import { beginMutate, canCommitMutate, type MutateGate } from "@/lib/mutate-gate";
import type { Rule } from "@/lib/rules";
import type { Account, Device, Group, Session, SyncStatus, UnifiSettings } from "@/lib/types";

/** A notice that can take its change back, such as the Undo after a pause. */
export type NoticeAction = { label: string; run: () => Promise<unknown> };

type Household = HouseholdPublic;

type AppData = {
  session: Session | null;
  groups: Group[];
  devices: Device[];
  /** Every household rule. Cards read their internet windows and category schedules from it. */
  rules: Rule[];
  sync: SyncStatus | null;
  unifi: UnifiSettings | null;
  household: Household | null;
  accounts: Account[];
  loading: boolean;
  error: string;
  notice: string;
  noticeAction: NoticeAction | null;
  reload: () => Promise<void>;
  mutate: (
    run: () => Promise<unknown>,
    optimistic?: (state: HouseholdLists) => HouseholdLists,
    feedback?: { notice: string; action?: NoticeAction },
  ) => Promise<MutationPayload | undefined>;
  dismissFeedback: () => void;
  busy: boolean;
};

const Ctx = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [unifi, setUnifi] = useState<UnifiSettings | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeAction, setNoticeAction] = useState<NoticeAction | null>(null);
  const [busy, setBusy] = useState(false);
  const listsRef = useRef<HouseholdLists>({ groups: [], devices: [] });
  const loadGen = useRef(0);
  const followGen = useRef(0);
  const mutateGate = useRef<MutateGate>({ latest: 0 });
  const busyCount = useRef(0);

  const bumpBusy = useCallback((delta: number) => {
    busyCount.current = Math.max(0, busyCount.current + delta);
    setBusy(busyCount.current > 0);
  }, []);

  const dismissFeedback = useCallback(() => {
    setError("");
    setNotice("");
    setNoticeAction(null);
  }, []);

  const commitLists = useCallback((next: HouseholdLists) => {
    listsRef.current = next;
    setGroups(next.groups);
    setDevices(next.devices);
  }, []);

  const router = useRouter();

  const reload = useCallback(async () => {
    const gen = ++loadGen.current;
    let sessionRes: { session: Session };
    try {
      sessionRes = await api<{ session: Session }>("/api/v1/auth/session");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
      }
      throw err;
    }
    const [groupsRes, devicesRes, rulesRes, syncRes, unifiRes, householdRes, accountsRes] = await Promise.all([
      api<{ groups: Group[] }>("/api/v1/groups"),
      api<{ devices: Device[] }>("/api/v1/devices"),
      api<{ rules: Rule[] }>("/api/v1/rules"),
      api<SyncStatus>("/api/v1/sync"),
      api<{ unifi: UnifiSettings }>("/api/v1/settings/unifi"),
      api<{ household: Household }>("/api/v1/settings/household"),
      api<{ accounts: Account[] }>("/api/v1/accounts"),
    ]);
    if (gen !== loadGen.current) return;
    listsRef.current = { groups: groupsRes.groups, devices: devicesRes.devices };
    setSession(sessionRes.session);
    setGroups(groupsRes.groups);
    setDevices(devicesRes.devices);
    setRules(rulesRes.rules);
    setSync(syncRes);
    setUnifi(unifiRes.unifi);
    setHousehold(householdRes.household);
    setAccounts(accountsRes.accounts);
  }, [router]);

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

  useEffect(() => {
    if (!notice || error) return;
    // A notice with an Undo stays long enough to use it.
    const timer = window.setTimeout(() => {
      setNotice("");
      setNoticeAction(null);
    }, noticeAction ? 12_000 : 6000);
    return () => window.clearTimeout(timer);
  }, [notice, error, noticeAction]);

  const mutate = useCallback(
    async (
      run: () => Promise<unknown>,
      optimistic?: (state: HouseholdLists) => HouseholdLists,
      feedback?: { notice: string; action?: NoticeAction },
    ) => {
      setError("");
      setNotice("");
      setNoticeAction(null);
      const previous = listsRef.current;
      const token = beginMutate(mutateGate.current);
      bumpBusy(1);
      try {
        if (optimistic) {
          flushSync(() => commitLists(optimistic(previous)));
        }
        const result = asMutationPayload(await run());
        if (!canCommitMutate(mutateGate.current, token)) {
          return result;
        }
        loadGen.current += 1;
        followGen.current += 1;
        const followToken = followGen.current;
        flushSync(() => {
          commitLists(applyMutationResult(listsRef.current, result));
          if (result.household) setHousehold(result.household);
          if (result.rule) setRules((current) => upsertRule(current, result.rule!));
          if (result.removedRuleId) setRules((current) => current.filter((rule) => rule.id !== result.removedRuleId));
          if (result.unifi) setUnifi(result.unifi);
          if (result.account) {
            setAccounts((current) => {
              const index = current.findIndex((item) => item.id === result.account!.id);
              if (index === -1) return [...current, result.account!];
              const next = current.slice();
              next[index] = result.account!;
              return next;
            });
          }
        });
        setNotice(feedback?.notice ?? "Saved.");
        setNoticeAction(feedback?.action ?? null);
        if (result.change?.changeId) {
          void waitForChange(result.change.changeId)
            .then(async (change) => {
              if (followToken !== followGen.current) return;
              if (change.status === "failed") setError(change.error ?? "That change did not apply.");
              else if (change.status === "partial") setNotice(change.error ?? "Reconcile finished with issues.");
              else if (change.status === "pending") setNotice(change.error ?? "Still applying.");
              else if (feedback) {
                // Keep the change's own notice, and its Undo, once the gateway has it.
                setError("");
              } else {
                setError("");
                setNotice("Saved. The gateway has the current desired state.");
              }
              await reload();
            })
            .catch(async (err: Error) => {
              if (followToken !== followGen.current) return;
              // Desired state is already in Postgres — keep Saved., soft Sync warning, still reload.
              setError("");
              setNotice(`Saved. Sync follow-up: ${err.message}`);
              await reload();
            });
        }
        return result;
      } catch (err) {
        if (canCommitMutate(mutateGate.current, token)) {
          flushSync(() => commitLists(previous));
          setError(err instanceof Error ? err.message : "Request failed.");
        }
        return undefined;
      } finally {
        bumpBusy(-1);
      }
    },
    [bumpBusy, commitLists, reload],
  );

  const value = useMemo(
    () => ({
      session,
      groups,
      devices,
      rules,
      sync,
      unifi,
      household,
      accounts,
      loading,
      error,
      notice,
      noticeAction,
      reload,
      mutate,
      dismissFeedback,
      busy,
    }),
    [
      session,
      groups,
      devices,
      rules,
      sync,
      unifi,
      household,
      accounts,
      loading,
      error,
      notice,
      noticeAction,
      reload,
      mutate,
      dismissFeedback,
      busy,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function upsertRule(rules: Rule[], rule: Rule): Rule[] {
  const index = rules.findIndex((item) => item.id === rule.id);
  if (index === -1) return [...rules, rule];
  const next = rules.slice();
  next[index] = rule;
  return next;
}

export function useAppData(): AppData {
  const value = useContext(Ctx);
  if (!value) throw new Error("useAppData must be used under AppDataProvider");
  return value;
}
