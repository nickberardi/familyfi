import { minutesText } from "./alert-copy";
import { formatClock } from "./display";
import { rulesToUnblock } from "./group-actions";
import { askSheetCustomOption, type CustomPause, type PauseSheetPicker } from "./pause-sheet";
import { activeWindowsEnd, ruleInternetWindows, type Rule } from "./rules";
import type { Group, GroupAsk } from "./types";

/*
 * A child's ask for more time, as a parent sees and answers it on every client, on the child's own
 * group or on a Thing shared with children, which names the child who asked. The group's card
 * and page show a waiting ask as one line, which opens the answer sheet: yes as the child asked,
 * yes for another time, or Not now. A yes to unpause is the group's `resume` on `internet`, a yes
 * to time off a rule is the rule's `allow` for the group, each with the ask's `askId`; Not now is
 * the ask's `decline` (`answerAsk` in `group-writes.ts`). Plain data, so the Watch can port it and
 * `tests/fixtures/display-vectors.json` can pin it.
 */

/**
 * What a choice on the answer sheet does: `asked` gives what the child asked for; `for` and `until`
 * lift the rule for another time (resolved at the tap, so a sheet left open never sends an end
 * already passed); `decline` is Not now.
 */
export type AskSheetRequest = { kind: "asked" } | { kind: "for"; minutes: number } | { kind: "until"; until: string } | { kind: "decline" };

export type AskSheetOption = { label: string; note: string; request: AskSheetRequest };

export type AskSheetChoice = AskSheetOption | PauseSheetPicker;

/** The group's ask while it waits for an answer, else null. */
export function waitingAsk(group: Pick<Group, "ask">, now: Date): GroupAsk | null {
  const ask = group.ask;
  if (!ask || ask.state !== "waiting") return null;
  if (ask.expiresAt && Date.parse(ask.expiresAt) <= now.getTime()) return null;
  return ask;
}

function ruleOf<R extends Pick<Rule, "id">>(ask: GroupAsk, rules: R[]): R | undefined {
  return ask.about === "rule" ? rules.find((rule) => rule.id === ask.ruleId) : undefined;
}

/**
 * What the child asked for: "to be unpaused", "for 30 minutes off Bedtime". On a shared Thing (`thing`
 * its name, or "it" on its own card): "to unblock TV".
 */
function askedFor(ask: GroupAsk, rules: Pick<Rule, "id" | "name">[], thing?: string): string {
  if (ask.about === "pause") return thing ? `to unblock ${thing}` : "to be unpaused";
  const name = ruleOf(ask, rules)?.name;
  const length = ask.minutes ? minutesText(ask.minutes) : null;
  // Time off the rule's block, never "of" it, as the alert says.
  if (length && name) return `for ${length} off ${name}`;
  if (name) return `for time off ${name}`;
  return length ? `for ${length} more` : "for more time";
}

/**
 * The line on the group's card and page while an ask waits, which opens the answer sheet: "Asked
 * to be unpaused", "Asked for 30 minutes off Bedtime". On a shared Thing it names the child who
 * asked: "Cassie asked to unblock it". Null with nothing waiting.
 */
export function groupAskLine(group: Pick<Group, "ask">, rules: Pick<Rule, "id" | "name">[], now: Date): string | null {
  const ask = waitingAsk(group, now);
  if (!ask) return null;
  return ask.from ? `${ask.from.name} asked ${askedFor(ask, rules, "it")}` : `Asked ${askedFor(ask, rules)}`;
}

/** The answer sheet's title: "Sam asked to be unpaused"; on a shared Thing "Cassie asked to unblock TV". */
export function askSheetTitle(group: Pick<Group, "name">, ask: GroupAsk, rules: Pick<Rule, "id" | "name">[]): string {
  return ask.from ? `${ask.from.name} asked ${askedFor(ask, rules, group.name)}` : `${group.name} asked ${askedFor(ask, rules)}`;
}

/**
 * When it was asked, and until when it waits: "Asked at 9:41 PM. It closes at 10:41 PM if no one
 * answers.", and why there is nothing to allow when the rule's window is no longer on.
 */
export function askSheetBody(ask: GroupAsk, rules: Rule[], timezone: string, now: Date): string {
  const at = `Asked at ${formatClock(new Date(ask.at), timezone)}.`;
  const closes = ask.expiresAt ? `${at} It closes at ${formatClock(new Date(ask.expiresAt), timezone)} if no one answers.` : at;
  // Time off a rule whose window is no longer on: nothing to allow, so only Not now is offered.
  if (ask.about === "rule" && askSheetOptions(ask, rules, timezone, now).length === 0) {
    const rule = ruleOf(ask, rules);
    const name = rule?.name ?? "That rule";
    // An always-on rule has no window to lift time off, as the server refuses it.
    const always = rule && activeWindowsEnd(ruleInternetWindows(rule), now, timezone) === null;
    return `${closes} ${name} ${always ? "is always on" : "isn't on now"}, so there's nothing to allow.`;
  }
  return closes;
}

/**
 * The answer sheet's quick choices. To unpause: Unpause, which ends the pause. On a shared Thing
 * (`group`, the Thing) it is Unblock, "ends the block now", as its card says, when ending the pause
 * leaves it unblocked; while an internet rule or its Block button rule blocks it too, so its card
 * still reads Blocked, Unpause, saying what still blocks it. To time off a rule:
 * what the child asked for, and the rest of the window when that is longer, each never past the
 * window's end, as the server caps it; nothing while the rule's window is not on, since then there is
 * nothing to lift. Not now comes last (`askSheetChoices`).
 */
export function askSheetOptions(ask: GroupAsk, rules: Rule[], timezone: string, now: Date, group?: Pick<Group, "id" | "blockButtonRuleId">): AskSheetOption[] {
  if (ask.about === "pause") {
    // A shared Thing's ask names the child who asked, and the Thing reads Blocked, as the child says.
    // What keeps its card Blocked once the pause ends: an internet rule's window, or its Block button
    // rule, named as one rule (its window, or the Block button rule's own name).
    const still = ask.from && group ? rulesToUnblock(group, rules, timezone, now).find((rule) => rule.kind === "internet" || rule.ruleId === group.blockButtonRuleId) : undefined;
    if (ask.from && group && !still) return [{ label: "Unblock", note: "ends the block now", request: { kind: "asked" } }];
    const name = still && (still.kind === "internet" ? still.name : (rules.find((rule) => rule.id === still.ruleId)?.name ?? still.name));
    return [{ label: "Unpause", note: still ? `ends the pause; ${name} still blocks it` : "ends the pause now", request: { kind: "asked" } }];
  }
  const rule = ruleOf(ask, rules);
  const end = rule ? activeWindowsEnd(ruleInternetWindows(rule), now, timezone) : undefined;
  // Not on now, or always on: no window to lift time off, and the server refuses it.
  if (!rule || !end) return [];
  const asked = ask.minutes ? new Date(now.getTime() + ask.minutes * 60_000) : null;
  // What the child asked for, unless it runs past the window's end: then it is the rest of the window.
  const fits = asked && (!end || asked.getTime() <= end.getTime());
  const options: AskSheetOption[] = [];
  if (ask.minutes && asked && fits) {
    options.push({ label: `Allow ${minutesText(ask.minutes)}`, note: `until ${formatClock(asked, timezone)}`, request: { kind: "asked" } });
  }
  if (end && (!fits || asked!.getTime() < end.getTime())) {
    options.push({ label: `Until ${rule.name} ends`, note: `until ${formatClock(end, timezone)}`, request: { kind: "until", until: end.toISOString() } });
  }
  return options;
}

/**
 * A parent's own time, from For… or Until…: lifted until then, or until the window ends if that is
 * sooner, as the server caps it. Null when the time can't be read or the rule's window is not on.
 */
export function askSheetCustom(custom: CustomPause, ask: GroupAsk, rules: Rule[], timezone: string, now: Date): AskSheetOption | null {
  const rule = ruleOf(ask, rules);
  const end = rule ? activeWindowsEnd(ruleInternetWindows(rule), now, timezone) : undefined;
  const option = !end ? null : askSheetCustomOption(custom, timezone, now);
  if (!option || option.request.kind === "extend" || option.request.kind === "current") return null;
  const until = option.request.kind === "pauseFor" ? new Date(now.getTime() + option.request.minutes * 60_000) : new Date(option.request.until!);
  if (end && until.getTime() >= end.getTime()) {
    return { label: option.label, note: `until ${formatClock(end, timezone)}`, request: { kind: "until", until: end.toISOString() } };
  }
  const request: AskSheetRequest = option.request.kind === "pauseFor" ? { kind: "for", minutes: option.request.minutes } : { kind: "until", until: until.toISOString() };
  return { label: option.label, note: `until ${formatClock(until, timezone)}`, request };
}

/** "Not now": the child can ask again after the household's wait. */
export function askDeclineOption(timezone: string, now: Date, waitMinutes: number | undefined): AskSheetOption {
  const note = waitMinutes === undefined ? "they can ask again later" : waitMinutes === 0 ? "they can ask again now" : `they can ask again at ${formatClock(new Date(now.getTime() + waitMinutes * 60_000), timezone)}`;
  return { label: "Not now", note, request: { kind: "decline" } };
}

/**
 * Every choice on the answer sheet, in order: the quick yeses, For… and Until… for a time of the
 * parent's own (only for time off a rule that is on now), and Not now last.
 */
export function askSheetChoices(
  ask: GroupAsk,
  rules: Rule[],
  timezone: string,
  now: Date,
  waitMinutes?: number,
  group?: Pick<Group, "id" | "blockButtonRuleId">,
): AskSheetChoice[] {
  const options = askSheetOptions(ask, rules, timezone, now, group);
  const custom: PauseSheetPicker[] =
    ask.about === "rule" && options.length
      ? [
          { label: "For…", note: "choose how long", picker: "for" },
          { label: "Until…", note: "choose a time", picker: "until" },
        ]
      : [];
  return [...options, ...custom, askDeclineOption(timezone, now, waitMinutes)];
}
