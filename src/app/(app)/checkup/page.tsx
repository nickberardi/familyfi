"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "@/lib/api";
import {
  CHECKUP_COPY as COPY,
  leftoverRemovalNotice,
  loadCheckup,
  putBackNow,
  recommendedRules,
  removeLeftoverPolicies,
  runCheckupNow,
  setCheckupDismissed,
  turnOnRecommended,
  type CheckupFinding,
  type CheckupPolicy,
  type CheckupState,
} from "@/lib/checkup";
import { toggleRuleEnabled } from "@/lib/group-writes";
import { PageHeader } from "@/components/PageHeader";
import { CANCEL_BUTTON, DESTRUCTIVE_BUTTON, SheetFrame } from "@/components/pair/SheetFrame";
import { useAppData } from "@/components/AppDataProvider";
import { Alert } from "@/ui/Alert";
import { NetworkCheckupCard, ProtectionCard } from "@/ui/CheckupContent";

export default function CheckupPage() {
  const { rules, groups, unifi, store, busy } = useAppData();
  const [checkup, setCheckup] = useState<CheckupState | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // The leftover policies waiting on the administrator's confirmation.
  const [confirming, setConfirming] = useState<CheckupPolicy[] | null>(null);
  const [removing, setRemoving] = useState(false);
  const [puttingBack, setPuttingBack] = useState(false);
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
    setNotice("");
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

  function askToRemove(policyIds: string[]) {
    const listed = checkup?.findings.find((finding) => finding.check === "leftover_policies")?.details.policies ?? [];
    setConfirming(listed.filter((policy) => policyIds.includes(policy.id)));
  }

  async function remove(policies: CheckupPolicy[]) {
    setRemoving(true);
    await write(async () => {
      const result = await removeLeftoverPolicies(request, policies.map((policy) => policy.id));
      setNotice(leftoverRemovalNotice(result));
      return result.checkup;
    });
    setRemoving(false);
    setConfirming(null);
  }

  /** A rule changed in UniFi that sync could not change back: sync now, then show how it went. */
  async function putBack() {
    setPuttingBack(true);
    await write(async () => {
      const result = await putBackNow(request);
      setNotice(result.notice);
      return result.checkup;
    });
    setPuttingBack(false);
  }

  const protections = recommendedRules(rules);
  return (
    <>
      <PageHeader title={COPY.title} sub={COPY.sub} />
      {error ? (
        <div className="mx-4 mt-4 md:mx-6">
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        </div>
      ) : null}
      {notice ? (
        <div className="mx-4 mt-4 md:mx-6">
          <Alert tone="info" role="status">
            {notice}
          </Alert>
        </div>
      ) : null}
      <div className="grid items-start gap-4 p-4 md:p-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <ProtectionCard
          rules={protections}
          groups={groups}
          networks={unifi?.networks ?? []}
          disabled={busy}
          onToggle={(rule) => void toggleRuleEnabled(store.mutate, rule)}
          onTurnOnAll={() => void turnOnRecommended(store.mutate, rules)}
        />
        <NetworkCheckupCard
          checkup={checkup}
          checking={checking}
          disabled={puttingBack}
          onCheckNow={() => void checkNow()}
          onDismiss={(finding: CheckupFinding, dismissed: boolean) => void write(() => setCheckupDismissed(request, finding.id, dismissed))}
          onRemovePolicies={askToRemove}
          onPutBack={() => void putBack()}
        />
      </div>
      {confirming ? <ConfirmRemove policies={confirming} busy={removing} onCancel={() => setConfirming(null)} onConfirm={() => void remove(confirming)} /> : null}
    </>
  );
}

/** The administrator's confirmation before FamilyFi removes leftover policies from the gateway. */
function ConfirmRemove({ policies, busy, onCancel, onConfirm }: { policies: CheckupPolicy[]; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const text = COPY.network.leftover;
  return (
    <SheetFrame
      title={text.confirmTitle(policies.length)}
      size="confirm"
      onClose={() => (busy ? undefined : onCancel())}
      footer={
        <>
          <button type="button" className={CANCEL_BUTTON} disabled={busy} onClick={onCancel}>
            {text.cancel}
          </button>
          <button
            type="button"
            data-testid="checkup-confirm-remove"
            className={DESTRUCTIVE_BUTTON}
            disabled={busy}
            onClick={onConfirm}
          >
            {text.confirm(policies.length)}
          </button>
        </>
      }
    >
      <ul className="flex flex-col gap-1 text-[14px] leading-5 font-semibold">
        {policies.map((policy) => (
          <li key={policy.id}>{policy.name}</li>
        ))}
      </ul>
      <p className="text-[14px] leading-5 text-[var(--ff-muted)]">{text.confirmBody}</p>
    </SheetFrame>
  );
}
