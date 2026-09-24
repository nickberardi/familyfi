"use client";

import { api } from "@/lib/api";
import { pauseSheetBody, pauseSheetOptions, pauseSheetTitle, type PauseSheetRequest } from "@/lib/pause-sheet";
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
  const options = pauseSheetOptions(group, mode, timezone, new Date());

  async function run(request: PauseSheetRequest) {
    if (request.kind === "extend") {
      await mutate(() =>
        api(`/api/v1/groups/${group.id}/extend`, {
          method: "POST",
          body: JSON.stringify({ minutes: request.minutes }),
        }),
      );
      return;
    }
    const until = request.kind === "pauseFor" ? untilFromMinutes(request.minutes).toISOString() : request.until;
    await mutate(() =>
      api(`/api/v1/groups/${group.id}/pause`, {
        method: "POST",
        body: JSON.stringify(until === null ? {} : { until }),
      }),
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ff-scrim)] p-6" onClick={onClose}>
      <div
        className="w-full max-w-[400px] overflow-hidden rounded-[14px] bg-[var(--ff-card)] shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-[18px]">
          <div className="text-[17px] font-bold tracking-tight">
            {pauseSheetTitle(group, mode)}
          </div>
          <p className="mt-1 text-[14px] leading-5 text-[var(--ff-muted)]">{pauseSheetBody(mode)}</p>
        </div>
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            className="flex w-full items-baseline gap-2.5 border-t border-[var(--ff-line)] px-[18px] py-3 text-left"
            onClick={() => {
              void run(option.request).then(onClose);
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
