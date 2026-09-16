"use client";

/**
 * The popover behind a filter mark.
 *
 * The Card System sketches four of these, but two of them (Checking… and the
 * purple "already blocked upstream" report) belong to the DNS probe, which is
 * out of scope for v0.3.0 — see issue #29. That leaves the two FamilyFi-owned
 * states: a filter we block, and one nothing is blocking yet.
 */

import { useState } from "react";
import { api } from "@/lib/api";
import { useAppData } from "@/components/AppDataProvider";
import type { Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";

export type FilterSheetState =
  | { kind: "category"; name: string; categoryId: number; rule: Rule | undefined }
  | { kind: "app"; name: string; rule: Rule };

export function FilterSheet({
  group,
  state,
  onClose,
  onChanged,
}: {
  group: Group;
  state: FilterSheetState;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { mutate } = useAppData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const on = Boolean(state.rule?.enabled);

  async function run(work: () => Promise<unknown>, failure: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await mutate(work);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : failure);
    } finally {
      setBusy(false);
    }
  }

  const turnOff = () =>
    run(
      () => api(`/api/v1/rules/${state.rule!.id}/off`, { method: "POST", body: "{}" }),
      "Could not turn off.",
    );

  const createOrEnable = () => {
    if (state.rule && !state.rule.enabled) {
      return run(
        () =>
          api(`/api/v1/rules/${state.rule!.id}`, {
            method: "PATCH",
            body: JSON.stringify({ enabled: true }),
          }),
        "Could not turn on.",
      );
    }
    if (state.kind === "category" && !state.rule) {
      return run(
        () =>
          api("/api/v1/rules", {
            method: "POST",
            body: JSON.stringify({
              kind: "category",
              scope: "group",
              groupId: group.id,
              targetIds: [state.categoryId],
              mode: "always",
            }),
          }),
        "Could not create the policy.",
      );
    }
    setError("Nothing to create.");
  };

  return (
    <div
      className="fixed inset-0 z-[81] flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,.32)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="filter-sheet-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[360px] overflow-hidden rounded-[14px]"
        style={{ background: "var(--ff-card)", boxShadow: "0 24px 60px rgba(0,0,0,.28)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col gap-2.5 p-5">
          <h2 id="filter-sheet-title" className="text-[16px] font-bold tracking-tight">
            {on ? `${state.name} · blocked` : `Nothing's blocking ${state.name} yet`}
          </h2>
          <p className="text-[13px] leading-snug" style={{ color: "var(--ff-ink-3)" }}>
            {on
              ? `Its own policy, its own controls — scoped to ${state.name} only.`
              : "Create a FamilyFi policy? Schedulable afterward, same as Internet."}
          </p>
          {error ? (
            <p className="text-[13px]" style={{ color: "var(--ff-danger)" }}>
              {error}
            </p>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void (on ? turnOff() : createOrEnable())}
            className="mt-1 rounded-[9px] py-2.5 text-center text-[14px] font-semibold disabled:opacity-50"
            style={
              on
                ? { background: "rgba(200,16,10,.1)", color: "var(--ff-danger)" }
                : { background: "var(--ff-accent)", color: "#fff" }
            }
          >
            {on ? "Turn off" : "Create policy"}
          </button>
        </div>
        <button
          type="button"
          className="w-full py-3 text-center text-[14px]"
          style={{ borderTop: "1px solid var(--ff-hairline-card)", color: "var(--ff-ink-3)" }}
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
