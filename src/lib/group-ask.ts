import { minutesText } from "./alert-copy";
import { formatClock } from "./display";
import { groupHeaderActions, rulesToUnblock, type GroupRun } from "./group-actions";
import { askSheetCustomOption, type CustomPause, type PauseSheetPicker } from "./pause-sheet";
import { ASK_AHEAD_MINUTES, activeWindowsEnd, askableWindows, ruleInternetWindows, type Rule } from "./rules";
import type { Group, GroupAsk } from "./types";

/*
 * A child's ask for more time, as a parent sees and answers it on every client, on the child's own
 * group or on a Thing shared with children, which names the child who asked. The group's card
 * and page show a waiting ask as one line, which opens the answer sheet: yes as the child asked,
 * yes for another time, or Not now. A yes to unblock is the group's own `unblock`, a yes
 * to time off a rule is the rule's `allow` for the group, each with the ask's `askId`; Not now is
 * the ask's `decline` (`answerAsk` in `group-writes.ts`). Plain data, so the Watch can port it and
 * `tests/fixtures/display-vectors.json` can pin it.
 */

/**
 * What a choice on the answer sheet does: `asked` gives what the child asked for; `for` and `until`
 * lift the rule for another time (resolved at the tap, so a sheet left open never sends an end
 * already passed); `decline` is Not now. `unblock` is the group card's own Unblock button
 * (`groupHeaderActions`), run as if the parent tapped it (`answerAsk`); `unblockFor` is that
 * button's answer for the length the child asked: a break in a pause that alone blocks, or the
 * button's sheet answered with that length.
 */
export type AskSheetRequest =
  | { kind: "asked" }
  | { kind: "unblock"; run: GroupRun; ruleId?: string; name?: string }
  | { kind: "unblockFor"; run: "pauseRule" | "unblock" | "unblockNow"; ruleId?: string; name?: string; minutes: number }
  | { kind: "for"; minutes: number } | { kind: "until"; until: string } | { kind: "decline" };

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
  const length = ask.minutes ? minutesText(ask.minutes) : null;
  if (ask.about === "pause") {
    const what = thing ? `to unblock ${thing}` : "to be unpaused";
    return length ? `${what} for ${length}` : what;
  }
  const name = ruleOf(ask, rules)?.name;
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
export function askSheetBody(ask: GroupAsk, rules: Rule[], timezone: string, now: Date, ahead: number = ASK_AHEAD_MINUTES): string {
  const at = `Asked at ${formatClock(new Date(ask.at), timezone)}.`;
  const closes = ask.expiresAt ? `${at} It closes at ${formatClock(new Date(ask.expiresAt), timezone)} if no one answers.` : at;
  // Time off a rule whose window is no longer on (nor about to start): nothing to allow, so only Not now is offered.
  if (ask.about === "rule" && askSheetOptions(ask, rules, timezone, now, undefined, ahead).length === 0) {
    const rule = ruleOf(ask, rules);
    const name = rule?.name ?? "That rule";
    // An always-on rule has no window to lift time off, as the server refuses it.
    const always = rule && activeWindowsEnd(ruleInternetWindows(rule), now, timezone) === null;
    return `${closes} ${name} ${always ? "is always on" : "isn't on now"}, so there's nothing to allow.`;
  }
  return closes;
}

/**
 * The answer sheet's quick choices. To unblock: Unblock, the group card's own Unblock button, which
 * does what a tap on it does: ends a pause that alone blocks at once, or opens its sheet, which asks
 * how long, for the Block button rule alone ("Unblock Video for TV?") or for everything blocking the
 * group; nothing while the card's button is not Unblock. Its note says what it lifts. Without the
 * group (`group`) it is the group's `resume` on `internet` with the ask's id. To time off a rule:
 * what the child asked for, and the rest of the window when that is longer, each never past the
 * window's end, as the server caps it; nothing while the rule's window is not on, since then there is
 * nothing to lift. A window starting within the household's `ahead` minutes counts as on (`askableWindows`): an ask from
 * the heads-up's countdown, whose time counts from the window's start. Not now comes last (`askSheetChoices`).
 */
export function askSheetOptions(
  ask: GroupAsk,
  rules: Rule[],
  timezone: string,
  now: Date,
  group?: Group,
  ahead: number = ASK_AHEAD_MINUTES,
): AskSheetOption[] {
  if (ask.about === "pause") {
    if (!group) return [{ label: "Unblock", note: "ends the block now", request: { kind: "asked" } }];
    const { action } = groupHeaderActions(group, rules, timezone, now);
    if (action.label !== "Unblock") return [];
    const request: AskSheetRequest = { kind: "unblock", run: action.run, ...(action.ruleId ? { ruleId: action.ruleId, name: action.name ?? "" } : {}) };
    if (action.run === "unblockNow") {
      const endsNow: AskSheetOption = { label: "Unblock", note: "ends the block now", request };
      if (!ask.minutes) return [endsNow];
      // A yes for the child's length gives the block a break, and it blocks again after, until its own end.
      const back = new Date(now.getTime() + ask.minutes * 60_000);
      const end = group.suspension.until ? Date.parse(group.suspension.until) : null;
      if (end !== null && back.getTime() >= end) return [endsNow];
      const asked: AskSheetRequest = { kind: "unblockFor", run: "unblockNow", minutes: ask.minutes };
      return [{ label: `Allow ${minutesText(ask.minutes)}`, note: `blocks again at ${formatClock(back, timezone)}`, request: asked }, endsNow];
    }
    const what = action.run === "pauseRule" ? (action.name ?? "") : listNames(rulesToUnblock(group, rules, timezone, now).map((rule) => rule.name));
    const lifts = group.suspension.active ? `ends the block and lifts ${what}` : `lifts ${what}`;
    const choose: AskSheetOption = { label: "Unblock", note: `${lifts}, for as long as you choose`, request };
    // What the child asked for first: the card's own sheet answered with their length.
    if (!ask.minutes || (action.run !== "pauseRule" && action.run !== "unblock")) return [choose];
    const until = formatClock(new Date(now.getTime() + ask.minutes * 60_000), timezone);
    const rule = action.ruleId ? { ruleId: action.ruleId, name: action.name ?? "" } : {};
    const asked: AskSheetRequest = { kind: "unblockFor", run: action.run, ...rule, minutes: ask.minutes };
    return [{ label: `Allow ${minutesText(ask.minutes)}`, note: `${lifts} until ${until}`, request: asked }, choose];
  }
  const rule = ruleOf(ask, rules);
  // The window on now, or the one starting within five minutes, whose time counts from its start.
  const window = rule ? askableWindows(ruleInternetWindows(rule), now, timezone, ahead) : undefined;
  const end = window?.end;
  // Not on now nor about to be, or always on: no window to lift time off, and the server refuses it.
  if (!rule || !window || !end) return [];
  const asked = ask.minutes ? new Date(window.from.getTime() + ask.minutes * 60_000) : null;
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
export function askSheetCustom(
  custom: CustomPause,
  ask: GroupAsk,
  rules: Rule[],
  timezone: string,
  now: Date,
  ahead: number = ASK_AHEAD_MINUTES,
): AskSheetOption | null {
  const rule = ruleOf(ask, rules);
  const window = rule ? askableWindows(ruleInternetWindows(rule), now, timezone, ahead) : undefined;
  const end = window?.end;
  const option = !window || !end ? null : askSheetCustomOption(custom, timezone, now);
  if (!window || !option || option.request.kind === "extend" || option.request.kind === "current") return null;
  // For… counts from the window's start when it has not started yet.
  const early = window.from.getTime() > now.getTime();
  const until = option.request.kind === "pauseFor" ? new Date(window.from.getTime() + option.request.minutes * 60_000) : new Date(option.request.until!);
  if (end && until.getTime() >= end.getTime()) {
    return { label: option.label, note: `until ${formatClock(end, timezone)}`, request: { kind: "until", until: end.toISOString() } };
  }
  if (until.getTime() <= window.from.getTime()) return null;
  const request: AskSheetRequest =
    option.request.kind === "pauseFor" && !early ? { kind: "for", minutes: option.request.minutes } : { kind: "until", until: until.toISOString() };
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
  group?: Group,
  ahead: number = ASK_AHEAD_MINUTES,
): AskSheetChoice[] {
  const options = askSheetOptions(ask, rules, timezone, now, group, ahead);
  const custom: PauseSheetPicker[] =
    ask.about === "rule" && options.length
      ? [
          { label: "For…", note: "choose how long", picker: "for" },
          { label: "Until…", note: "choose a time", picker: "until" },
        ]
      : [];
  return [...options, ...custom, askDeclineOption(timezone, now, waitMinutes)];
}

/** "Video", "Video and Gaming", "Bedtime, Video and Gaming", as the unblock sheet lists them. */
function listNames(items: string[]): string {
  const unique = [...new Set(items)];
  return unique.length <= 1 ? (unique[0] ?? "") : `${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}`;
}
