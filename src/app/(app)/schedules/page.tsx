"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { initials, roleTag } from "@/lib/display";
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

function ScheduleMark({ group }: { group: Group }) {
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

function kindTag(group: Group) {
  if (group.kind === "things") return `group · ${group.deviceCount}`;
  return roleTag(group);
}

function ScheduleRow({ group }: { group: Group }) {
  return (
    <ScheduleRowForm
      key={`${group.id}:${group.schedule.enabled}:${group.schedule.start}:${group.schedule.end}:${group.schedule.days.join(",")}`}
      group={group}
    />
  );
}

function ScheduleRowForm({ group }: { group: Group }) {
  const { mutate } = useAppData();
  const [enabled, setEnabled] = useState(group.schedule.enabled);
  const [start, setStart] = useState(asHm(group.schedule.start ?? "21:00"));
  const [end, setEnd] = useState(asHm(group.schedule.end ?? "07:00"));
  const [days, setDays] = useState<number[]>(
    group.schedule.days.length ? group.schedule.days : [0, 1, 2, 3, 4, 5, 6],
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function persist(next: { enabled: boolean; days: number[]; start: string; end: string }) {
    const startHm = asHm(next.start);
    const endHm = asHm(next.end);
    if (startHm === endHm) return;
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
      void persist({ enabled, days, start: nextStart, end: nextEnd });
    }, 400);
  }

  function toggleDay(day: number) {
    const next = days.includes(day) ? days.filter((item) => item !== day) : [...days, day].sort();
    if (enabled && next.length === 0) return;
    setDays(next);
    void persist({ enabled, days: next, start, end });
  }

  function toggleOn() {
    const next = !enabled;
    const nextDays = next && days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : days;
    setEnabled(next);
    setDays(nextDays);
    void persist({ enabled: next, days: nextDays, start, end });
  }

  const onStyle = enabled
    ? { background: "rgba(0,122,255,.1)", borderColor: "rgba(0,122,255,.35)", color: "#0066d6" }
    : { background: "#fff", borderColor: "rgba(60,60,67,.2)", color: "var(--ff-muted)" };

  const identity = (
    <div className="flex min-w-0 items-center gap-2.5">
      <ScheduleMark group={group} />
      <span className="min-w-0 truncate text-[14px] font-semibold">{group.name}</span>
      <span className="flex-none text-[14px] text-[var(--ff-muted)]">{kindTag(group)}</span>
    </div>
  );

  const times = (
    <>
      <label className="flex min-w-0 flex-col gap-1 text-[14px] font-semibold text-[var(--ff-muted)] md:block md:font-normal">
        <span className="md:sr-only">Offline</span>
        <input
          type="time"
          aria-label="Offline"
          className="w-full rounded-[7px] border border-[rgba(60,60,67,.22)] px-2 py-1.5 text-[16px] md:w-[118px] md:text-[14px]"
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
          className="w-full rounded-[7px] border border-[rgba(60,60,67,.22)] px-2 py-1.5 text-[16px] md:w-[118px] md:text-[14px]"
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
    <div className="flex min-w-0 flex-nowrap gap-1">
      {DAYS.map((day, index) => {
        const on = days.includes(day.value);
        return (
          <button
            key={`${day.value}-${index}`}
            type="button"
            aria-pressed={on}
            aria-label={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day.value]}
            onClick={() => toggleDay(day.value)}
            className="flex h-8 w-8 items-center justify-center rounded-[7px] border text-[14px] font-semibold"
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

  const onOff = (
    <button
      type="button"
      onClick={toggleOn}
      className="rounded-[7px] border px-3 py-1.5 text-[14px] font-semibold"
      style={onStyle}
    >
      {enabled ? "On" : "Off"}
    </button>
  );

  return (
    <div id={`group-${group.id}`} className="scroll-mt-24 border-t border-[rgba(60,60,67,.12)]">
      <div className="flex flex-col gap-3 p-4 md:hidden">
        <div className="flex items-center gap-3">
          {identity}
          <div className="ml-auto flex-none">{onOff}</div>
        </div>
        <div className="grid grid-cols-2 gap-3">{times}</div>
        {dayToggles}
      </div>
      <div className="hidden items-center gap-3.5 px-[18px] py-2.5 md:grid md:grid-cols-[minmax(180px,1.4fr)_118px_118px_minmax(248px,1fr)_120px]">
        {identity}
        {times}
        {dayToggles}
        <div className="flex justify-end">{onOff}</div>
      </div>
    </div>
  );
}

export default function SchedulesPage() {
  const { groups } = useAppData();
  const rows = groups.filter((group) => !group.protected);

  useEffect(() => {
    const id = window.location.hash.replace(/^#/, "");
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [rows]);

  return (
    <>
      <PageHeader
        title="Schedules"
        sub="Recurring bedtimes — desired configuration, applied on the next reconcile."
      />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        {rows.length === 0 ? (
          <p className="rounded-[12px] border border-[rgba(60,60,67,.14)] bg-white p-[18px] text-[14px] text-[var(--ff-muted)]">
            Add a Family or Things group first. Protected groups have no FamilyFi bedtime.
          </p>
        ) : (
          <div className="overflow-hidden rounded-[12px] border border-[rgba(60,60,67,.14)] bg-white md:overflow-x-auto">
            <div className="md:min-w-[920px]">
            <div className="hidden grid-cols-[minmax(180px,1.4fr)_118px_118px_minmax(248px,1fr)_120px] items-center gap-3.5 bg-[rgba(120,120,128,.06)] px-[18px] py-2.5 text-[14px] font-semibold text-[var(--ff-muted)] md:grid">
              <div>Member</div>
              <div>Offline</div>
              <div>Back on</div>
              <div>Days</div>
              <div className="text-right">Schedule</div>
            </div>
            {rows.map((group) => (
              <ScheduleRow key={group.id} group={group} />
            ))}
            </div>
          </div>
        )}
        <p className="max-w-[70ch] text-[14px] leading-5 text-[var(--ff-muted)]">
          Edits here are desired configuration. They are written to UniFi on the next reconcile, and Sync shows whether
          the gateway accepted them. Offline is when bedtime starts; Back on is when it ends.
        </p>
      </div>
    </>
  );
}
