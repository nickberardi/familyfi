import { daysLabel, windowTimes } from "./display";
import { FAMILYFI_POLICY_PREFIX, rulePolicyNames } from "./policy-names";
import { windowOverlaps } from "./rule-windows";
import type { RuleKind, RuleWindow } from "./rules";

/** A rule as the editor holds it. A window without an id has not been saved yet. */
export type RuleDraft = {
  id: string;
  name: string;
  useGeneratedName: boolean;
  kind: RuleKind;
  targetIds: number[];
  domains: string[];
  groupIds: string[];
  mode: "always" | "scheduled";
  windows: RuleWindow[];
};

export type RuleWrite = { verb: "NEW" | "CHANGE" | "DELETE" | "KEEP"; name: string; detail: string };

const sameList = (a: readonly (string | number)[], b: readonly (string | number)[]) =>
  [...a].sort().join() === [...b].sort().join();

/**
 * What saving the draft will write to UniFi, policy by policy, against the rule as it
 * was saved (null for a new rule). A window keeps its policy through an edit, so a
 * rename or a new time is a change to that policy, not a delete and a create.
 */
export function ruleWritePlan(saved: RuleDraft | null, draft: RuleDraft): RuleWrite[] {
  const names = rulePolicyNames(draft);
  const savedNames = saved ? rulePolicyNames(saved) : [];
  const blocksChanged =
    saved !== null &&
    (saved.kind !== draft.kind || !sameList(saved.targetIds, draft.targetIds) || !sameList(saved.domains, draft.domains));
  const groupsChanged = saved !== null && !sameList(saved.groupIds, draft.groupIds);
  const shared = [...(blocksChanged ? ["Blocks changed"] : []), ...(groupsChanged ? ["Groups changed"] : [])];
  const change = (name: string, before: string, reasons: string[]): RuleWrite => {
    const why = [...(before !== name ? [`Renamed from “${before}”`] : []), ...reasons, ...shared];
    return why.length ? { verb: "CHANGE", name, detail: why.join(" · ") } : { verb: "KEEP", name, detail: "No change" };
  };
  const writes: RuleWrite[] = [];

  if (draft.mode === "always") {
    const name = names[0] ?? `${FAMILYFI_POLICY_PREFIX}${draft.name}`;
    if (saved?.mode === "always") writes.push(change(name, savedNames[0]!, []));
    else writes.push({ verb: "NEW", name, detail: "Always on" });
    if (saved?.mode === "scheduled") {
      savedNames.forEach((before) => writes.push({ verb: "DELETE", name: before, detail: "Replaced by the always-on policy" }));
    }
    return writes;
  }

  if (saved?.mode === "always") writes.push({ verb: "DELETE", name: savedNames[0]!, detail: "Replaced by scheduled windows" });
  const savedWindows = saved?.mode === "scheduled" ? saved.windows : [];
  draft.windows.forEach((window, index) => {
    const name = names[index]!;
    const at = window.id ? savedWindows.findIndex((item) => item.id === window.id) : -1;
    if (at < 0) {
      writes.push({ verb: "NEW", name, detail: `${windowTimes(window.start, window.end)} · ${daysLabel(window.days)}` });
      return;
    }
    const before = savedWindows[at]!;
    const timesChanged = before.start !== window.start || before.end !== window.end || !sameList(before.days, window.days);
    const reasons = timesChanged
      ? [`Schedule ${windowTimes(before.start, before.end)} → ${windowTimes(window.start, window.end)}${sameList(before.days, window.days) ? "" : `, ${daysLabel(window.days)}`}`]
      : [];
    writes.push(change(name, savedNames[at]!, reasons));
  });
  savedWindows.forEach((window, index) => {
    if (draft.windows.some((item) => item.id === window.id)) return;
    writes.push({ verb: "DELETE", name: savedNames[index]!, detail: "Window removed · its time comes back online" });
  });
  return writes;
}

/** One sentence per pair of windows that block at the same time on some day. */
export function overlapNotices(windows: RuleWindow[]): string[] {
  const title = (window: RuleWindow, index: number) => `“${window.name.trim() || `Window ${index + 1}`}”`;
  return windowOverlaps(windows).map(([a, b]) => `${title(windows[a]!, a)} and ${title(windows[b]!, b)} overlap.`);
}
