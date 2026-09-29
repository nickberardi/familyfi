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
import Link from "next/link";
import { api } from "@/lib/api";
import { daysLabel, windowTimes } from "@/lib/display";
import { useAppData } from "@/components/AppDataProvider";
import type { Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";
import { checkedAgo, type UpstreamCheckRow } from "@/lib/upstream";
import { NetworkCheckDetails } from "@/components/upstream/NetworkCheckDetails";

export type FilterSheetState =
  | {
      kind: "category";
      name: string;
      /** The UniFi DPI category, or null when UniFi has none for it (AI, Dating, …). */
      categoryId: number | null;
      /** The domains its checks use; a Websites rule can block these instead. */
      domains: string[];
      rule: Rule | undefined;
      /** Already resolved for this card's group; null when nothing has been measured. */
      upstream: UpstreamCheckRow | null;
      /** Whether the rule is blocking at this moment, not merely switched on. */
      activelyBlocking: boolean;
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

  /**
   * Two different questions, deliberately kept apart.
   *
   * `owned` decides which *control* to offer, and turns on rule existence: a scheduled
   * rule sitting outside its window still needs a Turn off button, not an offer to
   * create the policy it already has.
   *
   * `blocking` decides what the sheet *reports*, and is true only while the rule is
   * actually blocking. Outside its window the honest report is whatever the resolver
   * is doing.
   */
  const owned = Boolean(state.rule?.enabled);
  const on = state.kind === "category" ? state.activelyBlocking : owned;

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
    if (state.kind === "category" && !state.rule && state.categoryId !== null) {
      return run(
        () =>
          api("/api/v1/rules", {
            method: "POST",
            body: JSON.stringify({
              name: `${state.name} for ${group.name}`.slice(0, 60),
              kind: "category",
              scope: "group",
              groupIds: [group.id],
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
  /** On but out of window: say so, rather than implying no policy exists. */
  const scheduledIdle = owned && !on;
  const upstreamBlocked = !on && upstream?.verdict === "blocked";
  const upstreamPartial = !on && upstream?.verdict === "partial";
  const measured = upstream ? ` Checked ${checkedAgo(upstream.checkedAt)}.` : "";

  const heading = on
    ? `${state.name} · blocked`
    : scheduledIdle && upstreamBlocked
      ? `Already blocked (DNS)`
      : scheduledIdle
        ? `${state.name} · scheduled, not now`
        : upstreamBlocked
      ? `Already blocked (DNS)`
      : upstreamPartial
        ? `Partially blocked (DNS)`
        : `Nothing's blocking ${state.name} yet`;

  /** UniFi has no category for it, so FamilyFi can only block its websites. */
  const websitesOnly = state.kind === "category" && state.categoryId === null && !state.rule;
  const websitesHref =
    state.kind === "category"
      ? `/rules/new?kind=domain&group=${group.id}&name=${encodeURIComponent(`${state.name} for ${group.name}`.slice(0, 60))}${
          state.domains.length ? `&domains=${encodeURIComponent(state.domains.join(","))}` : ""
        }`
      : "";
  const shared = (state.rule?.groupIds.length ?? 0) > 1;
  const windows = state.rule?.mode === "scheduled" ? state.rule.windows : [];
  const body = on
    ? `Its own policy, its own controls — scoped to ${state.name} only. Everything else stays on.${
        shared ? ` Turning it off turns “${state.rule!.name}” off for every group it covers.` : ""
      }`
    : scheduledIdle
      ? `${state.name} has a FamilyFi policy on a schedule, and this is not one of its hours.${
          upstreamBlocked ? " Its DNS resolver is blocking it anyway right now." : ""
        }`
      : upstreamBlocked
      ? `${group.name}'s DNS resolver already blocks every ${state.name} domain we test.${measured} FamilyFi is not doing it, so it cannot schedule or pause it — create a policy if you want that.`
      : upstreamPartial
        ? `${group.name}'s DNS resolver blocks ${upstream!.blockedCount} of ${upstream!.totalCount} ${state.name} domains we test.${measured} A FamilyFi policy would cover the rest.`
        : "Create a FamilyFi policy? Schedulable afterward, same as Internet.";
  const websitesNote = websitesOnly
    ? `UniFi has no ${state.name} category, so FamilyFi can't block it as one. A Websites rule can block the ${state.kind === "category" ? state.domains.length : 0} websites this category checks.`
    : "";

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
            {websitesOnly ? websitesNote : body}
          </p>
          {windows.length ? (
            <ul className="text-[13px] leading-snug" style={{ color: "var(--ff-ink-2)" }}>
              {windows.map((window) => (
                <li key={window.id}>
                  {window.name ? `${window.name} · ` : ""}
                  {windowTimes(window.start, window.end)} · {daysLabel(window.days)}
                </li>
              ))}
            </ul>
          ) : null}
          <NetworkCheckDetails check={upstream} />
          {error ? (
            <p className="text-[13px]" style={{ color: "var(--ff-danger)" }}>
              {error}
            </p>
          ) : null}
          {websitesOnly ? (
            <Link
              href={websitesHref}
              className="mt-1 rounded-[9px] py-2.5 text-center text-[14px] font-semibold"
              style={{ background: "var(--ff-accent)", color: "var(--ff-ink-on-fill)" }}
            >
              Block its websites
            </Link>
          ) : (
            <>
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
              <Link
                href={
                  state.rule
                    ? `/rules/${state.rule.id}`
                    : `/rules/new?kind=category&target=${state.kind === "category" ? state.categoryId : ""}&group=${group.id}`
                }
                className="text-center text-[14px] font-semibold"
                style={{ color: "var(--ff-accent)" }}
              >
                {state.rule ? "Edit rule and schedule" : "Schedule it instead"}
              </Link>
            </>
          )}
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
