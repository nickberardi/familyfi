"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "@/lib/api";
import { CHECKUP_COPY as COPY, loadCheckup, recommendedRules, runCheckupNow, setCheckupDismissed, turnOnRecommended, type CheckupFinding, type CheckupState } from "@/lib/checkup";
import { toggleRuleEnabled } from "@/lib/group-writes";
import { PageHeader } from "@/components/PageHeader";
import { useAppData } from "@/components/AppDataProvider";
import { NetworkCheckupCard, ProtectionCard } from "@/ui/CheckupContent";

export default function CheckupPage() {
  const { rules, groups, store, busy } = useAppData();
  const [checkup, setCheckup] = useState<CheckupState | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  // The checkup is page-owned, not in the provider, like Categories.
  const loadGen = useRef(0);

  const load = useCallback(async () => {
    const gen = ++loadGen.current;
    try {
      const next = await loadCheckup(request);
      if (gen === loadGen.current) setCheckup(next);
    } catch (err) {
      if (gen === loadGen.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    const start = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(start);
      loadGen.current += 1;
    };
  }, [load]);

  /** A write that returns the checkup, then a reload so the nav badge follows. */
  async function write(run: () => Promise<CheckupState>) {
    setError("");
    loadGen.current += 1;
    try {
      setCheckup(await run());
      void store.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function checkNow() {
    setChecking(true);
    await write(() => runCheckupNow(request));
    setChecking(false);
  }

  const protections = recommendedRules(rules);
  return (
    <>
      <PageHeader title={COPY.title} sub={COPY.sub} />
      {error ? (
        <p role="alert" className="mx-4 mt-4 rounded-[9px] bg-[var(--ff-danger-fill)] px-3 py-2 text-[14px] text-[var(--ff-danger)] md:mx-6">
          {error}
        </p>
      ) : null}
      <div className="grid items-start gap-4 p-4 md:p-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <ProtectionCard
          rules={protections}
          groups={groups}
          disabled={busy}
          onToggle={(rule) => void toggleRuleEnabled(store.mutate, rule)}
          onTurnOnAll={() => void turnOnRecommended(store.mutate, rules)}
        />
        <NetworkCheckupCard
          checkup={checkup}
          checking={checking}
          onCheckNow={() => void checkNow()}
          onDismiss={(finding: CheckupFinding, dismissed: boolean) => void write(() => setCheckupDismissed(request, finding.id, dismissed))}
        />
      </div>
    </>
  );
}
