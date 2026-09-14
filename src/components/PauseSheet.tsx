"use client";

import { api } from "@/lib/api";
import { formatClock, nextBedtimeResumeAt } from "@/lib/display";
import type { Group } from "@/lib/types";
import { useAppData } from "./AppDataProvider";

function untilFromMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60_000);
}

export function PauseSheet({
  group,
  mode,
  timezone,
  onClose,
}: {
  group: Group;
  mode: "pause" | "extend";
  timezone: string;
  onClose: () => void;
}) {
  const { mutate } = useAppData();
  const bedtimeAt = nextBedtimeResumeAt(group, timezone);
  const word = group.kind === "family" ? "bedtime" : "schedule";
  const options = [
    {
      label: "For 30 minutes",
      note: `schedule back at ${formatClock(untilFromMinutes(30), timezone)}`,
      run: () => timed(30),
    },
    {
      label: "For an hour",
      note: `schedule back at ${formatClock(untilFromMinutes(60), timezone)}`,
      run: () => timed(60),
    },
    ...(bedtimeAt
      ? [
          {
            label: "Until bedtime ends",
            note: `schedule back at ${formatClock(bedtimeAt, timezone)}`,
            run: () => pauseUntil(bedtimeAt.toISOString()),
          },
        ]
      : []),
    {
      label: "Until I resume",
      note: "no end time",
      run: () => pauseUntil(null),
    },
  ];

  async function pauseUntil(until: string | null) {
    await mutate(() =>
      api(`/api/v1/groups/${group.id}/pause`, {
        method: "POST",
        body: JSON.stringify(until === null ? {} : { until }),
      }),
    );
  }

  async function timed(minutes: number) {
    if (mode === "extend" && group.suspension.active && group.suspension.until) {
      await mutate(() =>
        api(`/api/v1/groups/${group.id}/extend`, {
          method: "POST",
          body: JSON.stringify({ minutes }),
        }),
      );
      return;
    }
    await pauseUntil(untilFromMinutes(minutes).toISOString());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/32 p-6" onClick={onClose}>
      <div
        className="w-full max-w-[400px] overflow-hidden rounded-[14px] bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-[18px]">
          <div className="text-[17px] font-bold tracking-tight">
            {mode === "extend" ? `More time for ${group.name}?` : `Pause ${group.name}’s ${word}?`}
          </div>
          <p className="mt-1 text-[14px] leading-5 text-[var(--ff-muted)]">
            {mode === "extend"
              ? "Extending keeps the schedule suspended longer. Resume restores bedtime, which may still block."
              : "Pause suspends bedtime enforcement so internet is available from FamilyFi. Resume restores the stored schedule, which may still block during bedtime."}
          </p>
        </div>
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            className="flex w-full items-baseline gap-2.5 border-t border-[var(--ff-line)] px-[18px] py-3 text-left"
            onClick={() => {
              void option.run().then(onClose);
            }}
          >
            <span className="flex-1 text-[15px] font-semibold text-[var(--ff-accent)]">{option.label}</span>
            <span className="text-[14px] text-[var(--ff-muted)]">{option.note}</span>
          </button>
        ))}
        <button
          type="button"
          className="w-full border-t border-[var(--ff-line)] py-3 text-center text-[14px] text-[var(--ff-muted)]"
          onClick={onClose}
        >
          Never mind
        </button>
      </div>
    </div>
  );
}
