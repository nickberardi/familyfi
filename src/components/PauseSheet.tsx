"use client";

import { applyGroupPause, applyRulePause } from "@/lib/group-writes";
import {
  pauseSheetBody,
  pauseSheetOptions,
  pauseSheetTitle,
  rulePauseSheetBody,
  rulePauseSheetOptions,
  rulePauseSheetTitle,
  type PauseSheetOption,
  type PauseSheetRequest,
} from "@/lib/pause-sheet";
import { internetWindowsForGroup, ruleInternetWindows, type Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";
import { useAppData } from "./AppDataProvider";

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
  const { store, rules, devices } = useAppData();
  const deviceNames = devices.filter((device) => device.groupId === group.id).map((device) => device.hostname ?? "");
  const options = pauseSheetOptions(group, internetWindowsForGroup(rules, group.id, new Date()), mode, timezone, new Date());

  async function run(request: PauseSheetRequest) {
    await applyGroupPause(store.mutate, group, request, timezone);
  }

  return (
    <PauseSheetView
      title={pauseSheetTitle(group, mode)}
      body={pauseSheetBody(group, mode, deviceNames)}
      options={options}
      onPick={(request) => run(request)}
      onClose={onClose}
    />
  );
}

/** The pause sheet for a rule: lifts it for every group it covers. */
export function RulePauseSheet({
  rule,
  mode,
  timezone,
  onClose,
}: {
  rule: Rule;
  mode: "pause" | "extend";
  timezone: string;
  onClose: () => void;
}) {
  const { store } = useAppData();
  const options = rulePauseSheetOptions(rule, ruleInternetWindows(rule), mode, timezone, new Date());

  async function run(request: PauseSheetRequest) {
    await applyRulePause(store.mutate, rule, request, timezone);
  }

  return (
    <PauseSheetView
      title={rulePauseSheetTitle(rule, mode)}
      body={rulePauseSheetBody(rule, mode)}
      options={options}
      onPick={(request) => run(request)}
      onClose={onClose}
    />
  );
}

function PauseSheetView({
  title,
  body,
  options,
  onPick,
  onClose,
}: {
  title: string;
  body: string;
  options: PauseSheetOption[];
  onPick: (request: PauseSheetRequest) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ff-scrim)] p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pause-sheet-title"
        className="w-full max-w-[400px] overflow-hidden rounded-[14px] bg-[var(--ff-card)] shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-[18px]">
          <h2 id="pause-sheet-title" className="text-[17px] font-bold tracking-tight">
            {title}
          </h2>
          <p className="mt-1 text-[14px] leading-5 text-[var(--ff-muted)]">{body}</p>
        </div>
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            className="flex w-full items-baseline gap-2.5 border-t border-[var(--ff-line)] px-[18px] py-3 text-left"
            onClick={() => {
              void onPick(option.request).then(onClose);
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
