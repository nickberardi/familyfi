"use client";

import { groupPauseSheet } from "@/lib/group-pause-sheet";
import { applyGroupPause, applyRulePause } from "@/lib/group-writes";
import {
  CUSTOM_PAUSE_MAX_MINUTES,
  RECENT_CUSTOM_PAUSE_KEY,
  customPauseLabel,
  parseCustomPause,
  pauseSheetCustom,
  rulePauseSheetBody,
  rulePauseSheetCustom,
  rulePauseSheetOptions,
  rulePauseSheetTitle,
  withCustomChoices,
  type CustomPause,
  type PauseSheetChoice,
  type PauseSheetOption,
  type PauseSheetPicker,
  type PauseSheetRequest,
} from "@/lib/pause-sheet";
import { ruleInternetWindows, type Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";
import { useState } from "react";
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
  const [recent, remember] = useRecentCustomPause();
  const now = new Date();
  const sheet = groupPauseSheet(group, rules, devices, mode, timezone, now, recent);

  async function run(request: PauseSheetRequest) {
    await applyGroupPause(store.mutate, group, request, timezone);
  }

  return (
    <PauseSheetView
      title={sheet.title}
      body={sheet.body}
      mode={mode}
      choices={sheet.choices}
      recent={recent}
      // Resolved when it is tapped, so a sheet left open never sends an end already passed.
      custom={(choice) => pauseSheetCustom(group, choice, mode, timezone, new Date())}
      onPick={(request) => run(request)}
      onCustom={remember}
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
  const [recent, remember] = useRecentCustomPause();
  const now = new Date();
  const options = rulePauseSheetOptions(rule, ruleInternetWindows(rule), mode, timezone, now);
  // Resolved when it is tapped, so a sheet left open never sends an end already passed.
  const custom = (choice: CustomPause) => rulePauseSheetCustom(rule, choice, mode, timezone, new Date());

  async function run(request: PauseSheetRequest) {
    await applyRulePause(store.mutate, rule, request, timezone);
  }

  return (
    <PauseSheetView
      title={rulePauseSheetTitle(rule, mode)}
      body={rulePauseSheetBody(rule, mode)}
      mode={mode}
      choices={withCustomChoices(options, recent && custom(recent))}
      recent={recent}
      custom={custom}
      onPick={(request) => run(request)}
      onCustom={remember}
      onClose={onClose}
    />
  );
}

/**
 * The last custom choice made in this browser, offered first next time. Storage can be missing or
 * refused (a private window), so the sheet works without it.
 */
function useRecentCustomPause(): [CustomPause | null, (choice: CustomPause) => void] {
  const [recent, setRecent] = useState<CustomPause | null>(() => {
    try {
      return parseCustomPause(window.localStorage.getItem(RECENT_CUSTOM_PAUSE_KEY));
    } catch {
      return null;
    }
  });
  function remember(choice: CustomPause) {
    setRecent(choice);
    try {
      window.localStorage.setItem(RECENT_CUSTOM_PAUSE_KEY, JSON.stringify(choice));
    } catch {
      // Not kept; the sheet still offered and applied it.
    }
  }
  return [recent, remember];
}

function isPicker(choice: PauseSheetChoice): choice is PauseSheetPicker {
  return "picker" in choice;
}

function PauseSheetView({
  title,
  body,
  mode,
  choices,
  recent,
  custom,
  onPick,
  onCustom,
  onClose,
}: {
  title: string;
  body: string;
  mode: "pause" | "extend";
  choices: PauseSheetChoice[];
  recent: CustomPause | null;
  custom: (choice: CustomPause) => PauseSheetOption | null;
  onPick: (request: PauseSheetRequest) => Promise<void>;
  onCustom: (choice: CustomPause) => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState<PauseSheetPicker["picker"] | null>(null);
  // The last custom choice is worked out again at the tap, like the picker's.
  const resolve = (option: PauseSheetOption) =>
    (recent && option.label === customPauseLabel(recent) && custom(recent)) || option;
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
        {choices.map((choice) => (
          <div key={choice.label}>
            <button
              type="button"
              aria-expanded={isPicker(choice) ? open === choice.picker : undefined}
              className="flex w-full items-baseline gap-2.5 border-t border-[var(--ff-line)] px-[18px] py-3 text-left"
              onClick={() => {
                if (isPicker(choice)) setOpen(open === choice.picker ? null : choice.picker);
                else void onPick(resolve(choice).request).then(onClose);
              }}
            >
              <span className="flex-1 text-[15px] font-semibold text-[var(--ff-accent)]">{choice.label}</span>
              <span className="text-[14px] text-[var(--ff-muted)]">{choice.note}</span>
            </button>
            {isPicker(choice) && open === choice.picker ? (
              <CustomPausePicker
                picker={choice.picker}
                recent={recent}
                mode={mode}
                custom={custom}
                onDone={(picked, option) => {
                  void onPick(option.request).then(() => {
                    onCustom(picked);
                    onClose();
                  });
                }}
              />
            ) : null}
          </div>
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

/** For…: hours and minutes. Until…: a time of day, the next time the clock reads it. */
function CustomPausePicker({
  picker,
  recent,
  mode,
  custom,
  onDone,
}: {
  picker: PauseSheetPicker["picker"];
  recent: CustomPause | null;
  mode: "pause" | "extend";
  custom: (choice: CustomPause) => PauseSheetOption | null;
  onDone: (choice: CustomPause, option: PauseSheetOption) => void;
}) {
  // Starts from the last custom choice of the same kind.
  const last = recent?.kind === "for" ? recent.minutes : 120;
  const [hours, setHours] = useState(String(Math.floor(last / 60)));
  const [minutes, setMinutes] = useState(String(last % 60));
  const [clock, setClock] = useState(recent?.kind === "until" ? recent.clock : "21:00");
  const total = Math.trunc(Number(hours) || 0) * 60 + Math.trunc(Number(minutes) || 0);
  const choice: CustomPause | null =
    picker === "for"
      ? total >= 1 && total <= CUSTOM_PAUSE_MAX_MINUTES
        ? { kind: "for", minutes: total }
        : null
      : clock
        ? { kind: "until", clock }
        : null;
  const option = choice ? custom(choice) : null;
  const field = "rounded-[7px] border px-2 py-1.5 text-[15px] outline-none";
  const fieldStyle = { borderColor: "var(--ff-input-line)", background: "var(--ff-card)" };
  return (
    <form
      className="flex flex-wrap items-center gap-2.5 bg-[var(--ff-field-soft)] px-[18px] py-3"
      onSubmit={(event) => {
        event.preventDefault();
        const fresh = choice && custom(choice);
        if (choice && fresh) onDone(choice, fresh);
      }}
    >
      {picker === "for" ? (
        <>
          <label className="flex items-center gap-1.5 text-[14px]">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={24}
              value={hours}
              onChange={(event) => setHours(event.target.value)}
              className={`${field} w-[64px]`}
              style={fieldStyle}
              autoFocus
            />
            hr
          </label>
          <label className="flex items-center gap-1.5 text-[14px]">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={59}
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              className={`${field} w-[64px]`}
              style={fieldStyle}
            />
            min
          </label>
        </>
      ) : (
        <label className="flex items-center gap-1.5 text-[14px]">
          Until
          <input
            type="time"
            required
            value={clock}
            onChange={(event) => setClock(event.target.value)}
            className={field}
            style={fieldStyle}
            autoFocus
          />
        </label>
      )}
      <span className="flex-1 text-right text-[14px] whitespace-nowrap text-[var(--ff-muted)]">{option ? option.note : picker === "for" ? "up to 24 hours" : ""}</span>
      <button
        type="submit"
        disabled={!option}
        className="rounded-[7px] bg-[var(--ff-accent)] px-3 py-1.5 text-[14px] font-semibold text-[var(--ff-ink-on-fill)] disabled:opacity-40"
      >
        {mode === "extend" ? "Add time" : "Pause"}
      </button>
    </form>
  );
}
