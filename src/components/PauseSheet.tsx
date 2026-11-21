"use client";

import { groupSheet, type GroupPauseSheetTarget, type GroupSheetTarget } from "@/lib/group-pause-sheet";
import { askSheetBody, askSheetChoices, askSheetCustom, askSheetTitle, waitingAsk } from "@/lib/group-ask";
import { answerAsk, applyGroupSheet, applyRulePause } from "@/lib/group-writes";
import {
  CUSTOM_PAUSE_MAX_MINUTES,
  RECENT_CUSTOM_PAUSE_KEY,
  customPauseLabel,
  parseCustomPause,
  rulePauseSheetBody,
  rulePauseSheetCustom,
  rulePauseSheetOptions,
  rulePauseSheetTitle,
  withCustomChoices,
  type CustomPause,
  type PauseSheetPicker,
  type PauseSheetRequest,
} from "@/lib/pause-sheet";
import { ruleInternetWindows, type Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";
import { useEffect, useRef, useState } from "react";
import { useAppData } from "./AppDataProvider";
import { CANCEL_BUTTON, PRIMARY_BUTTON } from "@/components/ui/buttons";
import { Modal } from "@/components/ui/Modal";

/**
 * A group card's sheet: its block, its unblock, a rule area's pause for it alone (`groupSheet`), or
 * the answer to a child's ask, whose Unblock opens the card's own sheet in its place (`onOpen`).
 */
export function PauseSheet({
  group,
  target,
  timezone,
  onOpen,
  onClose,
}: {
  group: Group;
  target: GroupSheetTarget;
  timezone: string;
  onOpen: (target: GroupSheetTarget) => void;
  onClose: () => void;
}) {
  if (target.kind === "ask") return <AskSheet group={group} timezone={timezone} onOpen={onOpen} onClose={onClose} />;
  return <GroupPauseSheet group={group} target={target} timezone={timezone} onClose={onClose} />;
}

function GroupPauseSheet({
  group,
  target,
  timezone,
  onClose,
}: {
  group: Group;
  target: GroupPauseSheetTarget;
  timezone: string;
  onClose: () => void;
}) {
  const { store, rules, devices } = useAppData();
  const [recent, remember] = useRecentCustomPause();
  const sheet = groupSheet(group, rules, devices, target, timezone, new Date(), recent);

  async function run(request: PauseSheetRequest) {
    await applyGroupSheet(store.mutate, group, target, request, timezone);
  }

  return (
    <PauseSheetView
      title={sheet.title}
      body={sheet.body}
      confirm={sheet.confirm}
      choices={sheet.choices}
      recent={recent}
      // Resolved when it is tapped, so a sheet left open never sends an end already passed.
      custom={(choice) => sheet.custom(choice, new Date())}
      onPick={(option) => run(option.request)}
      onCustom={remember}
      onClose={onClose}
    />
  );
}

/**
 * The answer to a child's waiting ask: yes as asked, yes for a time of the parent's own, or Not now
 * (`askSheetChoices`). An ask answered or closed while the sheet is open closes it.
 */
function AskSheet({ group, timezone, onOpen, onClose }: { group: Group; timezone: string; onOpen: (target: GroupSheetTarget) => void; onClose: () => void }) {
  const { store, rules, household } = useAppData();
  const now = new Date();
  const ask = waitingAsk(group, now);
  const closed = ask === null;
  // Unblock opens the card's own sheet once this one has closed.
  const next = useRef<GroupSheetTarget | null>(null);
  useEffect(() => {
    if (closed) onClose();
  }, [closed, onClose]);
  if (!ask) return null;
  const ruleName = ask.about === "rule" ? rules.find((rule) => rule.id === ask.ruleId)?.name : undefined;
  return (
    <PauseSheetView
      title={askSheetTitle(group, ask, rules)}
      body={askSheetBody(ask, rules, timezone, now, household?.askAheadMinutes)}
      confirm="Allow"
      choices={askSheetChoices(ask, rules, timezone, now, household?.askWaitMinutes, group, household?.askAheadMinutes)}
      recent={null}
      // Resolved when it is tapped, so a sheet left open never sends an end already passed.
      custom={(choice) => askSheetCustom(choice, ask, rules, timezone, new Date(), household?.askAheadMinutes)}
      onPick={(option) =>
        answerAsk(store.mutate, group, ask, option, ruleName, new Date(), (target) => {
          next.current = target;
        }).then(() => undefined)
      }
      onCustom={() => undefined}
      onClose={() => (next.current ? onOpen(next.current) : onClose())}
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
      confirm={mode === "extend" ? "Add time" : "Pause"}
      choices={withCustomChoices(options, recent && custom(recent))}
      recent={recent}
      custom={custom}
      onPick={(option) => run(option.request)}
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

/** A choice on a sheet: what it says, and what it does when tapped. */
type SheetOption<R> = { label: string; note: string; request: R };

function isPicker<R>(choice: SheetOption<R> | PauseSheetPicker): choice is PauseSheetPicker {
  return "picker" in choice;
}

function PauseSheetView<R>({
  title,
  body,
  confirm,
  choices,
  recent,
  custom,
  onPick,
  onCustom,
  onClose,
}: {
  title: string;
  body: string;
  /** The picker's button: Block, Unblock, Pause, Add time or Allow. */
  confirm: string;
  choices: (SheetOption<R> | PauseSheetPicker)[];
  recent: CustomPause | null;
  custom: (choice: CustomPause) => SheetOption<R> | null;
  onPick: (option: SheetOption<R>) => Promise<void>;
  onCustom: (choice: CustomPause) => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState<PauseSheetPicker["picker"] | null>(null);
  // The last custom choice is worked out again at the tap, like the picker's.
  const resolve = (option: SheetOption<R>) =>
    (recent && option.label === customPauseLabel(recent) && custom(recent)) || option;
  return (
    <Modal labelledBy="pause-sheet-title" size="confirm" onClose={onClose}>
      <div className="px-[18px] pt-[18px] pb-3">
        <h2 id="pause-sheet-title" className="text-[17px] leading-[24px] font-semibold tracking-tight">
          {title}
        </h2>
        <p className="mt-1.5 text-[14px] leading-5 text-[var(--ff-ink-2)]">{body}</p>
      </div>
      {choices.map((choice) => (
        <div key={choice.label}>
          <button
            type="button"
            aria-expanded={isPicker(choice) ? open === choice.picker : undefined}
            className="flex w-full items-baseline gap-2.5 border-t border-[var(--ff-line)] px-[18px] py-3 text-left"
            onClick={() => {
              if (isPicker(choice)) setOpen(open === choice.picker ? null : choice.picker);
              else void onPick(resolve(choice)).then(onClose);
            }}
          >
            <span className="flex-1 text-[15px] font-semibold text-[var(--ff-accent)]">{choice.label}</span>
            <span className="text-[14px] text-[var(--ff-muted)]">{choice.note}</span>
          </button>
          {isPicker(choice) && open === choice.picker ? (
            <CustomPausePicker
              picker={choice.picker}
              recent={recent}
              confirm={confirm}
              custom={custom}
              onDone={(picked, option) => {
                void onPick(option).then(() => {
                  onCustom(picked);
                  onClose();
                });
              }}
            />
          ) : null}
        </div>
      ))}
      <div className="flex justify-end border-t border-[var(--ff-line)] px-[18px] pt-3 pb-[18px]">
        <button type="button" className={CANCEL_BUTTON} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/** For…: hours and minutes. Until…: a time of day, the next time the clock reads it. */
function CustomPausePicker<R>({
  picker,
  recent,
  confirm,
  custom,
  onDone,
}: {
  picker: PauseSheetPicker["picker"];
  recent: CustomPause | null;
  confirm: string;
  custom: (choice: CustomPause) => SheetOption<R> | null;
  onDone: (choice: CustomPause, option: SheetOption<R>) => void;
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
  const field = "ff-input px-2 py-1";
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
          <label className="flex items-center gap-1.5 text-[14px] text-[var(--ff-muted)]">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={24}
              value={hours}
              onChange={(event) => setHours(event.target.value)}
              className={`${field} w-[64px]`}
              autoFocus
            />
            hr
          </label>
          <label className="flex items-center gap-1.5 text-[14px] text-[var(--ff-muted)]">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={59}
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              className={`${field} w-[64px]`}
            />
            min
          </label>
        </>
      ) : (
        <label className="flex items-center gap-1.5 text-[14px] text-[var(--ff-muted)]">
          Until
          <input
            type="time"
            required
            value={clock}
            onChange={(event) => setClock(event.target.value)}
            className={`${field} w-auto`}
            autoFocus
          />
        </label>
      )}
      <span className="flex-1 text-right text-[14px] whitespace-nowrap text-[var(--ff-muted)]">{option ? option.note : picker === "for" ? "up to 24 hours" : ""}</span>
      <button
        type="submit"
        disabled={!option}
        className={PRIMARY_BUTTON}
      >
        {confirm}
      </button>
    </form>
  );
}
