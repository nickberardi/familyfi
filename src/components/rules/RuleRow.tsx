"use client";

/**
 * One row of the Rules table — the same template for Internet parents, nested
 * category/app filters, and network-scoped rules.
 *
 * Layout is a single flex row that wraps, so there is no separate phone markup
 * and no fixed pixel grid to keep in step across breakpoints.
 */

import { useEffect, useRef, useState } from "react";
import { Mark } from "@/components/ui/Mark";
import { CategoryGlyph } from "@/components/ui/CategoryGlyph";
import { Segmented } from "@/components/ui/Segmented";
import { DayPicker } from "@/components/ui/DayPicker";
import { TimeField, TogglePill } from "@/components/ui/Controls";
import type { RuleRow as RuleRowModel } from "@/lib/rule-rows";

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export type ScheduleDraft = { days: number[]; start: string; end: string };

function asHm(value: string | null, fallback: string): string {
  if (!value) return fallback;
  return value.length >= 5 ? value.slice(0, 5) : value;
}

/** Background per row kind — nested filters and network rules are tinted. */
function rowBackground(row: RuleRowModel): string {
  if (row.kind === "network") return "var(--ff-row-network)";
  if (row.nested) return "var(--ff-row-nested)";
  return "var(--ff-card)";
}

export function RuleRow({
  row,
  onModeChange,
  onScheduleChange,
  onToggleEnabled,
  onDelete,
}: {
  row: RuleRowModel;
  onModeChange: (mode: "always" | "scheduled", schedule: ScheduleDraft) => void;
  onScheduleChange: (schedule: ScheduleDraft) => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
}) {
  const [start, setStart] = useState(() => asHm(row.schedule.start, "21:00"));
  const [end, setEnd] = useState(() => asHm(row.schedule.end, "07:00"));
  const [days, setDays] = useState<number[]>(() =>
    row.schedule.days.length ? row.schedule.days : ALL_DAYS,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync when the server hands back a different schedule for this row.
  const signature = `${row.schedule.start}|${row.schedule.end}|${row.schedule.days.join(",")}`;
  const lastSignature = useRef(signature);
  useEffect(() => {
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;
    setStart(asHm(row.schedule.start, "21:00"));
    setEnd(asHm(row.schedule.end, "07:00"));
    setDays(row.schedule.days.length ? row.schedule.days : ALL_DAYS);
  }, [signature, row.schedule]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const scheduled = row.mode === "scheduled";

  /** Times debounce — a stepper drag would otherwise fire a PUT per tick. */
  function queueTimes(nextStart: string, nextEnd: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (nextStart === nextEnd) return;
      onScheduleChange({ days, start: nextStart, end: nextEnd });
    }, 400);
  }

  function toggleDay(day: number) {
    const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort();
    if (next.length === 0) return;
    setDays(next);
    onScheduleChange({ days: next, start, end });
  }

  function pickMode(next: "always" | "scheduled") {
    if (next === row.mode) return;
    const nextDays = days.length ? days : ALL_DAYS;
    setDays(nextDays);
    onModeChange(next, { days: nextDays, start, end });
  }

  const indent = row.nested ? "var(--ff-rule-indent)" : "0px";
  const detailIndent = row.nested
    ? `calc(var(--ff-rule-indent) + var(--ff-rule-detail-indent))`
    : "var(--ff-rule-detail-indent)";

  return (
    <div
      id={row.anchorId}
      className="scroll-mt-24 px-[18px] py-3"
      style={{ borderTop: "1px solid var(--ff-hairline)", background: rowBackground(row) }}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5" style={{ paddingLeft: indent }}>
          <Mark
            kind={row.mark.kind}
            label={row.mark.label}
            density={row.nested ? "filter" : "dense"}
          >
            {row.mark.slot ? <CategoryGlyph slot={row.mark.slot} size={10} /> : undefined}
          </Mark>
          <span className="flex-none truncate text-[13.5px] font-semibold">
            {row.nested ? "↳ " : ""}
            {row.name}
          </span>
          <span className="min-w-0 flex-1 truncate text-[11.5px]" style={{ color: "var(--ff-ink-2)" }}>
            {row.kindTag}
          </span>
        </div>

        <Segmented
          name={row.kind === "internet" ? "Internet rule mode" : `${row.name} rule mode`}
          size="sm"
          value={row.mode}
          onChange={pickMode}
          segments={[
            { value: "always", label: "Always" },
            { value: "scheduled", label: "Scheduled" },
          ]}
        />

        <TogglePill on={row.enabled} onToggle={onToggleEnabled} label={row.name} />

        <div className="flex w-5 flex-none justify-center">
          {row.canDelete ? (
            <button
              type="button"
              onClick={onDelete}
              aria-label={`Delete ${row.name}`}
              className="flex h-5 w-5 items-center justify-center rounded-md text-[14px] leading-none"
              style={{ color: "var(--ff-danger)" }}
            >
              &times;
            </button>
          ) : null}
        </div>
      </div>

      {scheduled ? (
        <div
          className="mt-2.5 flex flex-wrap items-center gap-2.5"
          style={{ paddingLeft: detailIndent }}
        >
          <TimeField
            label="Offline"
            value={start}
            onChange={(value) => {
              setStart(value);
              queueTimes(value, end);
            }}
          />
          <TimeField
            label="Back on"
            value={end}
            onChange={(value) => {
              setEnd(value);
              queueTimes(start, value);
            }}
          />
          <DayPicker days={days} onToggle={toggleDay} />
        </div>
      ) : (
        <div
          className="mt-1.5 text-[12px]"
          style={{ paddingLeft: detailIndent, color: "var(--ff-locked)" }}
        >
          Blocks at all times
        </div>
      )}
    </div>
  );
}
