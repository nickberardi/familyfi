"use client";

/**
 * The popover behind a filter mark.
 *
 * Four states, following the same precedence as the mark: a FamilyFi policy we own
 * comes first, and when there is none the sheet reports what this group's own
 * resolver is doing — already blocked, partially blocked, or nothing at all.
 *
 * The upstream states are reports, not controls. FamilyFi did not block it and cannot
 * unblock it, so the only action offered is still to create our own policy, which is
 * worth doing when a household wants a schedule or wants it to survive a resolver
 * change.
 */

import { useState } from "react";
import { api } from "@/lib/api";
import { useAppData } from "@/components/AppDataProvider";
import type { Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";
import { checkedAgo, type UpstreamCheckRow } from "@/lib/upstream";

export type FilterSheetState =
  | {
      kind: "category";
      name: string;
      categoryId: number;
      rule: Rule | undefined;
      /** Already resolved for this card's group; null when nothing has been measured. */
      upstream: UpstreamCheckRow | null;
    }
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

  const upstream = state.kind === "category" ? state.upstream : null;
  const upstreamBlocked = !on && upstream?.verdict === "blocked";
  const upstreamPartial = !on && upstream?.verdict === "partial";
  const measured = upstream ? ` Checked ${checkedAgo(upstream.checkedAt)}.` : "";

  const heading = on
    ? `${state.name} · blocked`
    : upstreamBlocked
      ? `Already blocked (DNS)`
      : upstreamPartial
        ? `Partially blocked (DNS)`
        : `Nothing's blocking ${state.name} yet`;

  const body = on
    ? `Its own policy, its own controls — scoped to ${state.name} only.`
    : upstreamBlocked
      ? `${group.name}'s DNS resolver already blocks every ${state.name} domain we test.${measured} FamilyFi is not doing it, so it cannot schedule or pause it — create a policy if you want that.`
      : upstreamPartial
        ? `${group.name}'s DNS resolver blocks ${upstream!.blockedCount} of ${upstream!.totalCount} ${state.name} domains we test.${measured} A FamilyFi policy would cover the rest.`
        : "Create a FamilyFi policy? Schedulable afterward, same as Internet.";

  return (
    <div
      className="fixed inset-0 z-[81] flex items-center justify-center p-6"
      style={{ background: "var(--ff-scrim)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="filter-sheet-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[360px] overflow-hidden rounded-[14px]"
        style={{ background: "var(--ff-card)", boxShadow: "var(--ff-shadow-sheet)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col gap-2.5 p-5">
          <h2 id="filter-sheet-title" className="text-[16px] font-bold tracking-tight">
            {heading}
          </h2>
          <p className="text-[13px] leading-snug" style={{ color: "var(--ff-ink-3)" }}>
            {body}
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
                ? { background: "var(--ff-danger-fill)", color: "var(--ff-danger)" }
                : { background: "var(--ff-accent)", color: "var(--ff-ink-on-fill)" }
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
