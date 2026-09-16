"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { initials } from "@/lib/display";
import { PageHeader } from "@/components/PageHeader";
import { useAppData } from "@/components/AppDataProvider";
import type { Group } from "@/lib/types";

const DAYS = [
  { value: 0, label: "S" },
  { value: 1, label: "M" },
  { value: 2, label: "T" },
  { value: 3, label: "W" },
  { value: 4, label: "T" },
  { value: 5, label: "F" },
  { value: 6, label: "S" },
];

function asHm(value: string) {
  return value.length >= 5 ? value.slice(0, 5) : value;
}

function RuleMark({ group }: { group: Group }) {
  if (group.kind === "things") {
    const mark = (group.monogram ?? group.name.slice(0, 2)).slice(0, 4);
    return (
      <div
        className="flex h-6 w-6 flex-none items-center justify-center rounded-[6px] bg-[var(--ff-mark)] font-bold text-white"
        style={{ fontSize: mark.length > 2 ? 8 : 9 }}
      >
        {mark}
      </div>
    );
  }
  return (
    <div className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-[rgba(52,199,89,.16)] text-[11px] font-semibold text-[var(--ff-on)]">
      {initials(group.name).slice(0, 1)}
    </div>
  );
}

function RuleRow({ group }: { group: Group }) {
  return (
    <RuleRowForm
      key={`${group.id}:${group.mode}:${group.schedule.enabled}:${group.schedule.start}:${group.schedule.end}:${group.schedule.days.join(",")}`}
      group={group}
    />
  );
}

function RuleRowForm({ group }: { group: Group }) {
  const { mutate } = useAppData();
  const scheduled = group.mode === "scheduled" || group.schedule.enabled;
  const [enabled, setEnabled] = useState(scheduled);
  const [start, setStart] = useState(asHm(group.schedule.start ?? "21:00"));
  const [end, setEnd] = useState(asHm(group.schedule.end ?? "07:00"));
  const [days, setDays] = useState<number[]>(
    group.schedule.days.length ? group.schedule.days : [0, 1, 2, 3, 4, 5, 6],
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function persist(next: { enabled: boolean; days: number[]; start: string; end: string }) {
    const startHm = asHm(next.start);
    const endHm = asHm(next.end);
    if (next.enabled && startHm === endHm) return;
    if (next.enabled && next.days.length === 0) return;
    await mutate(() =>
      api(`/api/v1/groups/${group.id}/schedule`, {
        method: "PUT",
        body: JSON.stringify({ enabled: next.enabled, days: next.days, start: startHm, end: endHm }),
      }),
    );
  }

  function queueTime(nextStart: string, nextEnd: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void persist({ enabled: true, days, start: nextStart, end: nextEnd });
    }, 400);
  }

  function toggleDay(day: number) {
    if (!enabled) return;
    const next = days.includes(day) ? days.filter((item) => item !== day) : [...days, day].sort();
    if (next.length === 0) return;
    setDays(next);
    void persist({ enabled: true, days: next, start, end });
  }

  function setMode(nextEnabled: boolean) {
    if (nextEnabled === enabled) return;
    const nextDays = nextEnabled && days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : days;
    setEnabled(nextEnabled);
    setDays(nextDays);
    void persist({ enabled: nextEnabled, days: nextDays, start, end });
  }

  const identity = (
    <div className="flex min-w-0 items-center gap-2.5">
      <RuleMark group={group} />
      <span className="min-w-0 truncate text-[14px] font-semibold">{group.name}</span>
      <span className="flex-none text-[14px] text-[var(--ff-muted)]">Internet</span>
    </div>
  );

  const times = (
    <>
      <label className="flex min-w-0 flex-col gap-1 text-[14px] font-semibold text-[var(--ff-muted)] md:block md:font-normal">
        <span className="md:sr-only">Offline</span>
        <input
          type="time"
          aria-label="Offline"
          disabled={!enabled}
          className="w-full rounded-[7px] border border-[rgba(60,60,67,.22)] px-2 py-1.5 text-[16px] disabled:cursor-not-allowed disabled:opacity-40 md:w-[118px] md:text-[14px]"
          value={start}
          onChange={(event) => {
            const value = asHm(event.target.value);
            setStart(value);
            queueTime(value, end);
          }}
        />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-[14px] font-semibold text-[var(--ff-muted)] md:block md:font-normal">
        <span className="md:sr-only">Back on</span>
        <input
          type="time"
          aria-label="Back on"
          disabled={!enabled}
          className="w-full rounded-[7px] border border-[rgba(60,60,67,.22)] px-2 py-1.5 text-[16px] disabled:cursor-not-allowed disabled:opacity-40 md:w-[118px] md:text-[14px]"
          value={end}
          onChange={(event) => {
            const value = asHm(event.target.value);
            setEnd(value);
            queueTime(start, value);
          }}
        />
      </label>
    </>
  );

  const dayToggles = (
    <div className={`flex min-w-0 flex-nowrap gap-1 ${enabled ? "" : "pointer-events-none opacity-40"}`}>
      {DAYS.map((day, index) => {
        const on = days.includes(day.value);
        return (
          <button
            key={`${day.value}-${index}`}
            type="button"
            aria-pressed={on}
            aria-label={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day.value]}
            disabled={!enabled}
            onClick={() => toggleDay(day.value)}
            className="flex h-8 w-8 items-center justify-center rounded-[7px] border text-[14px] font-semibold disabled:cursor-not-allowed"
            style={{
              background: on ? "var(--ff-accent)" : "#fff",
              color: on ? "#fff" : "var(--ff-muted)",
              borderColor: on ? "var(--ff-accent)" : "rgba(60,60,67,.2)",
            }}
          >
            {day.label}
          </button>
        );
      })}
    </div>
  );

  const modeControl = (
    <div className="flex gap-0.5 rounded-[8px] bg-[rgba(120,120,128,.12)] p-0.5" role="group" aria-label="Internet rule mode">
      <button
        type="button"
        aria-pressed={!enabled}
        onClick={() => setMode(false)}
        className="rounded-[6px] px-2.5 py-1.5 text-[13px] font-semibold"
        style={
          !enabled
            ? { background: "#fff", color: "var(--ff-ink)", boxShadow: "0 0 0 1px rgba(60,60,67,.12)" }
            : { background: "transparent", color: "var(--ff-muted)" }
        }
      >
        Always
      </button>
      <button
        type="button"
        aria-pressed={enabled}
        onClick={() => setMode(true)}
        className="rounded-[6px] px-2.5 py-1.5 text-[13px] font-semibold"
        style={
          enabled
            ? { background: "#fff", color: "var(--ff-ink)", boxShadow: "0 0 0 1px rgba(60,60,67,.12)" }
            : { background: "transparent", color: "var(--ff-muted)" }
        }
      >
        Scheduled
      </button>
    </div>
  );

  return (
    <div id={`group-${group.id}`} className="scroll-mt-24 border-t border-[rgba(60,60,67,.12)]">
      <div className="flex flex-col gap-3 p-4 md:hidden">
        <div className="flex items-center gap-3">
          {identity}
          <div className="ml-auto flex-none">{modeControl}</div>
        </div>
        {enabled ? (
          <>
            <div className="grid grid-cols-2 gap-3">{times}</div>
            {dayToggles}
          </>
        ) : null}
      </div>
      <div className="hidden items-center gap-3.5 px-[18px] py-2.5 md:grid md:grid-cols-[minmax(200px,1.5fr)_118px_118px_minmax(248px,1fr)_160px]">
        {identity}
        {enabled ? times : <><div /><div /></>}
        {enabled ? dayToggles : <div />}
        <div className="flex justify-end">{modeControl}</div>
      </div>
    </div>
  );
}

function NewRuleModal({ onClose, groups }: { onClose: () => void; groups: Group[] }) {
  const [scope, setScope] = useState<"member" | "network">("member");
  const [targetType, setTargetType] = useState<"category" | "app">("category");
  const [enforcement, setEnforcement] = useState<"always" | "scheduled">("always");
  const [targetId, setTargetId] = useState("");
  const selectedTargetId = groups.some((g) => g.id === targetId) ? targetId : (groups[0]?.id ?? "");

  const seg = (active: boolean) =>
    active
      ? { background: "#fff", color: "var(--ff-ink)", boxShadow: "0 0 0 1px rgba(60,60,67,.12)" }
      : { background: "transparent", color: "var(--ff-muted)" };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/32 p-6" role="dialog" aria-modal="true" aria-labelledby="new-rule-title">
      <div className="w-full max-w-[420px] overflow-hidden rounded-[14px] bg-white shadow-[0_24px_60px_rgba(0,0,0,.28)]">
        <div className="px-5 pt-[18px] pb-1">
          <h2 id="new-rule-title" className="text-[17px] font-bold tracking-tight">
            New rule
          </h2>
          <p className="mt-1 text-[13px] leading-snug text-[var(--ff-muted)]">
            Blocks a category or app for one person or group.
          </p>
        </div>
        <div className="flex flex-col gap-3.5 px-5 py-4">
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-[var(--ff-muted)]">Applies to</div>
            <div className="flex gap-0.5 rounded-[8px] bg-[rgba(120,120,128,.12)] p-0.5">
              <button type="button" className="flex-1 rounded-[6px] py-1.5 text-center text-[13px] font-semibold" style={seg(scope === "member")} onClick={() => setScope("member")}>
                Person / group
              </button>
              <button type="button" className="flex-1 rounded-[6px] py-1.5 text-center text-[13px] font-semibold" style={seg(scope === "network")} onClick={() => setScope("network")}>
                Network
              </button>
            </div>
          </div>
          {scope === "member" ? (
            <select className="w-full rounded-lg border border-[var(--ff-line)] px-3 py-2.5 text-[16px]" value={selectedTargetId} onChange={(e) => setTargetId(e.target.value)}>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-[13px] text-[var(--ff-muted)]">Managed networks from Settings — available in a later phase.</p>
          )}
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-[var(--ff-muted)]">Target type</div>
            <div className="flex gap-0.5 rounded-[8px] bg-[rgba(120,120,128,.12)] p-0.5">
              <button type="button" className="flex-1 rounded-[6px] py-1.5 text-center text-[13px] font-semibold" style={seg(targetType === "category")} onClick={() => setTargetType("category")}>
                Category
              </button>
              <button type="button" className="flex-1 rounded-[6px] py-1.5 text-center text-[13px] font-semibold" style={seg(targetType === "app")} onClick={() => setTargetType("app")}>
                App
              </button>
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-[var(--ff-muted)]">Enforcement</div>
            <div className="flex gap-0.5 rounded-[8px] bg-[rgba(120,120,128,.12)] p-0.5">
              <button type="button" className="flex-1 rounded-[6px] py-1.5 text-center text-[13px] font-semibold" style={seg(enforcement === "always")} onClick={() => setEnforcement("always")}>
                Always
              </button>
              <button type="button" className="flex-1 rounded-[6px] py-1.5 text-center text-[13px] font-semibold" style={seg(enforcement === "scheduled")} onClick={() => setEnforcement("scheduled")}>
                Scheduled
              </button>
            </div>
          </div>
          <p className="rounded-[9px] bg-[rgba(120,120,128,.08)] px-3 py-2.5 text-[13px] leading-snug text-[var(--ff-muted)]">
            Category and app rules land in the next phase. Internet Always / Scheduled is editable on each row above.
          </p>
        </div>
        <div className="flex border-t border-[rgba(60,60,67,.14)]">
          <button type="button" onClick={onClose} className="flex-1 py-3 text-center text-[14px] text-[var(--ff-muted)]">
            Cancel
          </button>
          <button
            type="button"
            disabled
            className="flex-1 cursor-not-allowed border-l border-[rgba(60,60,67,.14)] py-3 text-center text-[14px] font-semibold text-[rgba(60,60,67,.35)]"
          >
            Create rule
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RulesPage() {
  const { groups } = useAppData();
  const rows = groups.filter((group) => !group.protected);
  const [newRuleOpen, setNewRuleOpen] = useState(false);

  useEffect(() => {
    const id = window.location.hash.replace(/^#/, "");
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [rows]);

  return (
    <>
      <PageHeader
        title="Rules"
        sub="Internet rules — desired configuration, applied on the next Sync."
        actionLabel="New rule"
        onAction={() => setNewRuleOpen(true)}
      />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        {rows.length === 0 ? (
          <p className="rounded-[12px] border border-[rgba(60,60,67,.14)] bg-white p-[18px] text-[14px] text-[var(--ff-muted)]">
            Add a Family or Things group first. Protected groups have no FamilyFi Internet rules.
          </p>
        ) : (
          <div className="overflow-hidden rounded-[12px] border border-[rgba(60,60,67,.14)] bg-white md:overflow-x-auto">
            <div className="md:min-w-[960px]">
              <div className="hidden grid-cols-[minmax(200px,1.5fr)_118px_118px_minmax(248px,1fr)_160px] items-center gap-3.5 bg-[rgba(120,120,128,.06)] px-[18px] py-2.5 text-[14px] font-semibold text-[var(--ff-muted)] md:grid">
                <div>Member</div>
                <div>Offline</div>
                <div>Back on</div>
                <div>Days</div>
                <div className="text-right">Mode</div>
              </div>
              {rows.map((group) => (
                <RuleRow key={group.id} group={group} />
              ))}
            </div>
          </div>
        )}
        <p className="max-w-[70ch] text-[14px] leading-5 text-[var(--ff-muted)]">
          Each row is the Internet parent for that member or Things group. Always keeps a permanent block; Scheduled uses
          Offline / Back on times. Edits are desired configuration — Sync writes them to UniFi. Internet rows are not
          deletable.
        </p>
      </div>
      {newRuleOpen ? <NewRuleModal key="new-rule" onClose={() => setNewRuleOpen(false)} groups={rows} /> : null}
    </>
  );
}
