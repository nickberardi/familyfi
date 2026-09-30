import { formatClock } from "./display";
import { internetRulePath } from "./group-actions";
import type { HouseholdStore } from "./household-store";
import type { PauseSheetRequest } from "./pause-sheet";
import type { Rule } from "./rules";
import type { Group } from "./types";

/**
 * The internet writes every client sends from a card or a pause sheet, with their notices. A
 * group's verbs act on its built-in `internet` rule; a rule's on the rule for every group it covers.
 */

type Mutate = HouseholdStore["mutate"];

function pauseUntil(request: Exclude<PauseSheetRequest, { kind: "extend" }>, now: Date): string | null {
  return request.kind === "pauseFor" ? new Date(now.getTime() + request.minutes * 60_000).toISOString() : request.until;
}

const until = (iso: string | null, timezone: string) => (iso ? `until ${formatClock(new Date(iso), timezone)}` : "until you resume");

/** A group's pause-sheet choice: extend its pause, or pause all its internet until a time or until resumed. */
export function applyGroupPause(mutate: Mutate, group: Group, request: PauseSheetRequest, timezone: string, now: Date = new Date()) {
  const path = internetRulePath(group);
  if (request.kind === "extend") {
    return mutate((send) => send(`${path}/extend`, { method: "POST", body: { minutes: request.minutes } }), { groupId: group.id });
  }
  const to = pauseUntil(request, now);
  // Name the scope and who it hits, and offer the way back.
  return mutate((send) => send(`${path}/pause`, { method: "POST", body: to === null ? {} : { until: to } }), {
    groupId: group.id,
    feedback: {
      notice: `All internet paused for ${group.name} ${until(to, timezone)}.`,
      action: { label: "Undo", run: (send) => send(`${path}/resume`, { method: "POST" }) },
    },
  });
}

/** A rule's pause-sheet choice: extend its pause, or pause the rule until a time or until resumed. */
export function applyRulePause(mutate: Mutate, rule: Pick<Rule, "id" | "name">, request: PauseSheetRequest, timezone: string, now: Date = new Date()) {
  const path = `/api/v1/rules/${rule.id}`;
  if (request.kind === "extend") {
    return mutate((send) => send(`${path}/extend`, { method: "POST", body: { minutes: request.minutes } }));
  }
  const to = pauseUntil(request, now);
  return mutate((send) => send(`${path}/pause`, { method: "POST", body: to === null ? {} : { until: to } }), {
    feedback: {
      notice: `${rule.name} paused ${until(to, timezone)}.`,
      action: { label: "Undo", run: (send) => send(`${path}/resume`, { method: "POST" }) },
    },
  });
}

/** A card's direct actions: resume a pause, allow internet now, or resume the schedule after an allowance. */
export function runGroupAction(mutate: Mutate, group: Group, run: "resume" | "allow" | "disallow") {
  const path = internetRulePath(group);
  return mutate((send) => send(`${path}/${run}`, { method: "POST", body: run === "allow" ? {} : undefined }), { groupId: group.id });
}
