"use client";

import { PageHeader } from "@/components/PageHeader";
import { useAppData } from "@/components/AppDataProvider";
import {
  changeActionLabel,
  changePolicyLabel,
  changeResultColor,
  changeResultLabel,
  formatLogWhen,
  issueActionLabel,
  issueResultColor,
  issueResultLabel,
  relativeSweep,
} from "@/lib/sync-copy";

export default function SyncPage() {
  const { sync, household } = useAppData();
  const run = sync?.lastRun;
  const timezone = household?.timezone ?? "America/New_York";
  const failing = sync?.failingCount ?? 0;
  const issues = sync?.issues ?? [];
  const writeIssue = issues.find((issue) => issue.kind !== "no_members");
  const failingNote = writeIssue?.message ?? run?.error ?? "see the log";
  const sweepAt = run?.finishedAt ?? run?.startedAt ?? null;
  const stats = [
    {
      label: "App-owned policies",
      value: String(sync?.appPolicyCount ?? 0),
      ink: "var(--ff-ink)",
      note: "named FamilyFi …",
    },
    {
      label: "Admin policies touched",
      value: "0",
      ink: "var(--ff-on)",
      note: "never modified or reordered",
    },
    {
      label: "Failing",
      value: String(failing),
      ink: failing ? "var(--ff-danger)" : "var(--ff-on)",
      note: failing ? failingNote : "nothing queued",
    },
    {
      label: "Last sweep",
      value: relativeSweep(sweepAt),
      ink: "var(--ff-ink)",
      note: run ? `${run.status} · revision ${run.appliedRevision ?? run.requestedRevision}` : "no sweep yet",
    },
  ];

  return (
    <>
      <PageHeader
        title="Sync"
        sub="App-owned policy state, sweeps, and failures."
      />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-[12px] border border-[rgba(60,60,67,.14)] bg-white px-[18px] py-4">
              <div className="text-[14px] font-semibold tracking-wide text-[var(--ff-muted)] uppercase">{stat.label}</div>
              <div className="mt-1.5 text-[26px] font-bold tracking-tight" style={{ color: stat.ink }}>
                {stat.value}
              </div>
              <div className="mt-0.5 text-[14px] text-[var(--ff-muted)]">{stat.note}</div>
            </div>
          ))}
        </div>

        <div className="overflow-hidden rounded-[12px] border border-[rgba(60,60,67,.14)] bg-white">
          <div className="grid grid-cols-[minmax(92px,128px)_minmax(0,1fr)_minmax(80px,96px)] items-center gap-3.5 bg-[rgba(120,120,128,.06)] px-[18px] py-2.5 text-[14px] font-semibold text-[var(--ff-muted)]">
            <div>When</div>
            <div>Action</div>
            <div className="text-right">Result</div>
          </div>
          {issues.length ? (
            issues.map((issue) => (
              <div
                key={issue.groupId}
                className="grid grid-cols-[minmax(92px,128px)_minmax(0,1fr)_minmax(80px,96px)] items-start gap-3.5 border-t border-[rgba(60,60,67,.12)] px-[18px] py-3"
              >
                <div className="text-[14px] text-[var(--ff-muted)]">{sweepAt ? formatLogWhen(sweepAt, timezone) : "Now"}</div>
                <div className="min-w-0">
                  <div className="text-[14px] text-pretty">{issueActionLabel(issue.kind)}</div>
                  <div
                    className="mt-0.5 text-[14px] leading-5 text-pretty"
                    style={{ color: issueResultColor(issue.kind) }}
                  >
                    {issue.message}
                  </div>
                </div>
                <div className="text-right text-[14px] font-semibold" style={{ color: issueResultColor(issue.kind) }}>
                  {issueResultLabel(issue.kind)}
                </div>
              </div>
            ))
          ) : null}
          {!sync?.changes?.length && !issues.length ? (
            <p className="px-[18px] py-4 text-[14px] text-[var(--ff-muted)]">No changes yet. Reconcile writes desired state to UniFi.</p>
          ) : (
            (sync?.changes ?? []).map((change) => (
              <div
                key={change.id}
                className="grid grid-cols-[minmax(92px,128px)_minmax(0,1fr)_minmax(80px,96px)] items-start gap-3.5 border-t border-[rgba(60,60,67,.12)] px-[18px] py-3"
              >
                <div className="text-[14px] text-[var(--ff-muted)]">{formatLogWhen(change.updatedAt, timezone)}</div>
                <div className="min-w-0">
                  <div className="text-[14px] text-pretty">{changeActionLabel(change.scope)}</div>
                  {change.error ? (
                    <div className="mt-0.5 text-[14px] leading-5 text-[var(--ff-danger)] text-pretty">{change.error}</div>
                  ) : change.deviceMac ? (
                    <div className="mt-0.5 font-mono text-[14px] leading-5 text-[var(--ff-muted)]">
                      {changePolicyLabel(change.deviceMac)}
                    </div>
                  ) : null}
                </div>
                <div
                  className="text-right text-[14px] font-semibold"
                  style={{ color: changeResultColor(change.status) }}
                >
                  {changeResultLabel(change.status)}
                </div>
              </div>
            ))
          )}
        </div>

        <p className="max-w-[78ch] rounded-[12px] border border-[rgba(60,60,67,.14)] bg-white px-[18px] py-3.5 text-[14px] leading-5 text-[var(--ff-muted)]">
          Only policies FamilyFi created appear here — named with a <span className="font-mono">FamilyFi</span> prefix.
          Ownership is the recorded policy ID, not the name. Administrator rules are never modified, disabled, or
          reordered.
        </p>
      </div>
    </>
  );
}
