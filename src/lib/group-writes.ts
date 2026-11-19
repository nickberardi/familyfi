import { formatClock } from "./display";
import { groupAddedNotice, groupEditBody, newGroupBody, type GroupEditDraft, type NewGroupDraft } from "./group-form";
import { internetRulePath, type GroupRuleRun, type GroupRun } from "./group-actions";
import type { GroupPauseSheetTarget, GroupSheetTarget } from "./group-pause-sheet";
import type { ApiRequest } from "./api-client";
import type { HouseholdStore } from "./household-store";
import type { AskSheetOption } from "./group-ask";
import type { PauseSheetRequest } from "./pause-sheet";
import type { InternetRulePreset, Rule } from "./rules";
import { assignDeviceLocally } from "./household-state";
import { ruleToggleNotice } from "./rule-list";
import type { Device, Group, GroupAsk } from "./types";

/**
 * The internet writes every client sends from a card or a pause sheet, with their notices. A
 * group's verbs act on its built-in `internet` rule; a rule's on the rule for every group it covers.
 */

type Mutate = HouseholdStore["mutate"];

function pauseUntil(request: Exclude<PauseSheetRequest, { kind: "extend" } | { kind: "current" }>, now: Date): string | null {
  return request.kind === "pauseFor" ? new Date(now.getTime() + request.minutes * 60_000).toISOString() : request.until;
}

const until = (iso: string | null, timezone: string) => (iso ? `until ${formatClock(new Date(iso), timezone)}` : "until you resume");

/** A group's block-sheet choice: give its block more time, or block all its internet until a time or until unblocked. */
export function applyGroupPause(mutate: Mutate, group: Group, request: PauseSheetRequest, timezone: string, now: Date = new Date()) {
  const path = internetRulePath(group);
  if (request.kind === "extend") {
    return mutate((send) => send(`${path}/extend`, { method: "POST", body: { minutes: request.minutes } }), { groupId: group.id });
  }
  if (request.kind === "current") return Promise.resolve(undefined);
  const to = pauseUntil(request, now);
  // Name the scope and who it hits, and offer the way back.
  return mutate((send) => send(`${path}/pause`, { method: "POST", body: to === null ? {} : { until: to } }), {
    groupId: group.id,
    feedback: {
      notice: `All internet blocked for ${group.name} ${to ? until(to, timezone) : "until you unblock"}.`,
      action: { label: "Undo", run: (send) => send(`${path}/resume`, { method: "POST" }) },
    },
  });
}

/**
 * A group sheet's choice (`groupSheet`): its block, its unblock (what blocks now until it ends,
 * or every rule until a time), or a pause of a rule area's rules for this group alone.
 */
export function applyGroupSheet(mutate: Mutate, group: Group, target: GroupPauseSheetTarget, request: PauseSheetRequest, timezone: string, now: Date = new Date()) {
  if (target.kind === "block") return applyGroupPause(mutate, group, request, timezone, now);
  if (target.kind === "unblock") {
    const path = `/api/v1/groups/${group.id}/unblock`;
    if (request.kind === "extend") {
      return mutate((send) => send(`${path}/extend`, { method: "POST", body: { minutes: request.minutes } }), { groupId: group.id });
    }
    const to = request.kind === "current" ? undefined : pauseUntil(request, now);
    return mutate((send) => send(path, { method: "POST", body: to === undefined ? {} : { until: to } }), {
      groupId: group.id,
      feedback: {
        notice: to === undefined ? `${group.name} unblocked until the block ends.` : `${group.name} unblocked ${until(to, timezone)}.`,
        // Undo can bring back its rules, but not a block the unblock ended.
        ...(group.suspension.active ? {} : { action: { label: "Undo", run: (send: ApiRequest) => send(`${path}/end`, { method: "POST" }) } }),
      },
    });
  }
  if (request.kind === "current") return Promise.resolve(undefined);
  const paths = target.ruleIds.map((ruleId) => `/api/v1/groups/${group.id}/rules/${ruleId}`);
  if (request.kind === "extend") {
    return mutate((send) => sendEach(send, paths, "extend", { minutes: request.minutes }), { groupId: group.id });
  }
  const to = pauseUntil(request, now);
  return mutate((send) => sendEach(send, paths, "pause", to === null ? {} : { until: to }), {
    groupId: group.id,
    feedback: {
      notice: `${target.name.charAt(0).toUpperCase()}${target.name.slice(1)} ${target.wording === "unblock" ? "unblocked" : "paused"} for ${group.name} ${until(to, timezone)}.`,
      action: { label: "Undo", run: (send) => sendEach(send, paths, "resume") },
    },
  });
}

/** One verb to each of a group's rules, as one write: the rules it returns, and the last change. */
async function sendEach(send: ApiRequest, paths: string[], verb: string, body?: object) {
  const results = await Promise.all(paths.map((path) => send<{ rule: Rule; change: { changeId: string } }>(`${path}/${verb}`, { method: "POST", body })));
  return { rules: results.map((result) => result.rule), change: results.at(-1)?.change };
}

/** A group card's direct header actions: unblock when only its own block holds it, or end its unblock. */
export function runGroupHeaderAction(mutate: Mutate, group: Group, run: "unblockNow" | "resume") {
  const path = `/api/v1/groups/${group.id}/unblock`;
  return mutate((send) => send(run === "unblockNow" ? path : `${path}/end`, { method: "POST", body: run === "unblockNow" ? {} : undefined }), {
    groupId: group.id,
  });
}

/**
 * A rule area's Resume: its rules apply to the group again. From the card's dropdown (`blockedAgain`:
 * the rule's name, and until when it was lifted) it says so, and Undo lifts it again until then.
 */
export function resumeGroupRules(mutate: Mutate, group: Group, ruleIds: string[], blockedAgain?: { name: string; until: string | null }) {
  const paths = ruleIds.map((ruleId) => `/api/v1/groups/${group.id}/rules/${ruleId}`);
  if (!blockedAgain) return mutate((send) => sendEach(send, paths, "resume"), { groupId: group.id });
  const { name, until: lifted } = blockedAgain;
  return mutate((send) => sendEach(send, paths, "resume"), {
    groupId: group.id,
    feedback: {
      notice: `${name.charAt(0).toUpperCase()}${name.slice(1)} blocked again for ${group.name}.`,
      action: { label: "Undo", run: (send) => sendEach(send, paths, "pause", lifted === null ? {} : { until: lifted }) },
    },
  });
}

/** A rule's pause-sheet choice: extend its pause, or pause the rule until a time or until resumed. */
export function applyRulePause(mutate: Mutate, rule: Pick<Rule, "id" | "name">, request: PauseSheetRequest, timezone: string, now: Date = new Date()) {
  const path = `/api/v1/rules/${rule.id}`;
  if (request.kind === "extend") {
    return mutate((send) => send(`${path}/extend`, { method: "POST", body: { minutes: request.minutes } }));
  }
  if (request.kind === "current") return Promise.resolve(undefined);
  const to = pauseUntil(request, now);
  return mutate((send) => send(`${path}/pause`, { method: "POST", body: to === null ? {} : { until: to } }), {
    feedback: {
      notice: `${rule.name} paused ${until(to, timezone)}.`,
      action: { label: "Undo", run: (send) => send(`${path}/resume`, { method: "POST" }) },
    },
  });
}

/**
 * A parent's answer to a child's ask (`askSheetChoices`). Yes to unblock is the group's `unblock`,
 * as its card's Unblock; yes to time off a rule is the rule's `allow` for the group, as the child asked or until
 * a time of the parent's own (`now` is the tap). Each carries the ask's `askId`, so the ask closes as
 * yes, by this parent; Not now is the ask's `decline`. The ask leaves the card at once.
 */
export function answerAsk(mutate: Mutate, group: Group, ask: GroupAsk, option: AskSheetOption, ruleName: string | undefined, now: Date = new Date()) {
  const answered = (state: GroupAsk["state"]) => (lists: { groups: Group[]; devices: Device[] }) => ({
    ...lists,
    groups: lists.groups.map((item) => (item.id === group.id && item.ask?.id === ask.id ? { ...item, ask: { ...ask, state, answeredAt: now.toISOString() } } : item)),
  });
  const { request } = option;
  if (request.kind === "decline") {
    return mutate((send) => send(`/api/v1/groups/${group.id}/asks/${ask.id}/decline`, { method: "POST" }), {
      groupId: group.id,
      optimistic: answered("no"),
      feedback: { notice: `You said not now to ${ask.from?.name ?? group.name}.` },
    });
  }
  // A yes to unblock is the group's own Unblock, lifting what its card's Unblock would.
  if (ask.about === "pause") {
    return mutate((send) => send(`/api/v1/groups/${group.id}/unblock`, { method: "POST", body: { askId: ask.id } }), {
      groupId: group.id,
      optimistic: answered("yes"),
      feedback: { notice: `${group.name} unblocked.` },
    });
  }
  const until =
    request.kind === "for" ? new Date(now.getTime() + request.minutes * 60_000).toISOString() : request.kind === "until" ? request.until : undefined;
  return mutate(
    (send) => send(`/api/v1/groups/${group.id}/rules/${ask.ruleId}/allow`, { method: "POST", body: until === undefined ? { askId: ask.id } : { askId: ask.id, until } }),
    {
      groupId: group.id,
      optimistic: answered("yes"),
      feedback: { notice: `${ruleName ?? "The rule"} is off for ${group.name} ${option.note}.` },
    },
  );
}

/**
 * Adding, editing and deleting a group, and assigning a device to one. Each resolves to the
 * store's payload, or undefined when there was nothing to send or the write failed (the store
 * reports a failure).
 */
export function createGroup(mutate: Mutate, draft: NewGroupDraft) {
  const body = newGroupBody(draft);
  if (!body) return Promise.resolve(undefined);
  return mutate((send) => send<{ group: Group; change: { changeId: string } }>("/api/v1/groups", { method: "POST", body }), {
    feedback: { notice: groupAddedNotice(body.name) },
  });
}

export function updateGroup(mutate: Mutate, group: Group, draft: GroupEditDraft, feedback?: { notice: string }) {
  const body = groupEditBody(group, draft);
  if (!body) return Promise.resolve(undefined);
  return mutate((send) => send<{ group: Group; change: { changeId: string } }>(`/api/v1/groups/${group.id}`, { method: "PUT", body }), {
    groupId: group.id,
    feedback,
  });
}

/**
 * Deletes a group; its devices become quarantined (Unassigned). `onDeleted` runs once the server
 * has deleted it and before it leaves the household, so a page showing the group can move away
 * without ever drawing it as missing.
 */
export function deleteGroup(mutate: Mutate, group: Pick<Group, "id">, onDeleted?: () => void) {
  return mutate(async (send) => {
    const result = await send<{ change: { changeId: string } }>(`/api/v1/groups/${group.id}`, { method: "DELETE" });
    onDeleted?.();
    return { ...result, removedGroupId: group.id };
  }, { groupId: group.id });
}

export function assignDevicePath(mac: string): string {
  return `/api/v1/devices/${encodeURIComponent(mac)}/assignment`;
}

/** Puts a device in a group, or leaves it Unassigned (`null`); the card updates at once. */
export function assignDevice(mutate: Mutate, device: Pick<Device, "mac">, groupId: string | null) {
  return mutate((send) => send<{ device: Device; change: { changeId: string } }>(assignDevicePath(device.mac), { method: "PUT", body: { groupId } }), {
    optimistic: (state) => assignDeviceLocally(state, device.mac, groupId),
  });
}

/** Turn a rule on or off for every group it covers. */
export function toggleRuleEnabled(mutate: Mutate, rule: Pick<Rule, "id" | "name" | "enabled">) {
  return mutate((send) => send<{ rule: Rule }>(`/api/v1/rules/${rule.id}`, { method: "PATCH", body: { enabled: !rule.enabled } }), {
    feedback: { notice: ruleToggleNotice(rule) },
  });
}

/** A rule card's direct actions: resume a pause, allow now, or end an allowance. */
export function runRuleAction(mutate: Mutate, rule: Pick<Rule, "id">, run: "resume" | "allow" | "disallow") {
  return mutate((send) => send(`/api/v1/rules/${rule.id}/${run}`, { method: "POST", body: run === "allow" ? {} : undefined }));
}

/** One tap to a common internet rule for a group (`internetRulePresets`): a scheduled rule with that one window. */
export function addInternetPreset(mutate: Mutate, group: Pick<Group, "id" | "name">, preset: InternetRulePreset) {
  return mutate(
    (send) =>
      send<{ rule: Rule }>("/api/v1/rules", {
        method: "POST",
        body: {
          name: preset.name,
          kind: "internet",
          groupIds: [group.id],
          mode: "scheduled",
          windows: [{ name: preset.name, days: preset.days, start: preset.start, end: preset.end }],
        },
      }),
    { feedback: { notice: `${preset.name} added for ${group.name}. FamilyFi writes it to the gateway next.` } },
  );
}

/** A tap on a group card: its header's button or More time, a rule area's (`ruleIds`, called `name`), or its ask line. */
export type GroupCardRun =
  /**
   * `ruleId` and `name`: the Block button rule a rule run acts on. `liftedUntil`: when its lift for
   * the group ended, so the Undo of `resumeRule` lifts it until then again.
   */
  | { kind: "header"; run: GroupRun; ruleId?: string; name?: string; liftedUntil?: string | null }
  | {
      kind: "rule";
      run: GroupRuleRun;
      ruleIds: string[];
      name: string;
      /** From the card's dropdown: its sheet and notices say unblock, and a Block again can be undone back to `liftedUntil`. */
      wording?: "unblock";
      liftedUntil?: string | null;
    }
  /** The line for a child's waiting ask: opens its answer sheet. */
  | { kind: "ask" };

/**
 * What a group card's tap does, the same on every client: Block, Unblock, Pause and every More
 * time open a sheet (`openSheet`, each platform its own way); Unblock with only the group's own
 * block holding it, Resume of an unblock, and a rule area's Resume write at once.
 */
export function runGroupCardAction(mutate: Mutate, group: Group, tap: GroupCardRun, openSheet: (target: GroupSheetTarget) => void) {
  if (tap.kind === "ask") return openSheet({ kind: "ask" });
  if (tap.kind === "header" && tap.ruleId && tap.name !== undefined) {
    const rule = { ruleIds: [tap.ruleId], name: tap.name, wording: "unblock" as const };
    // The Block button rule's lift for the group is one rule's, as its dropdown item would be.
    if (tap.run === "pauseRule") return runGroupCardAction(mutate, group, { kind: "rule", run: "pause", ...rule }, openSheet);
    if (tap.run === "moreRule") return runGroupCardAction(mutate, group, { kind: "rule", run: "extend", ...rule }, openSheet);
    if (tap.run === "resumeRule") return void resumeGroupRules(mutate, group, rule.ruleIds, { name: tap.name, until: tap.liftedUntil ?? null });
  }
  if (tap.kind === "rule") {
    if (tap.run === "resume") {
      return void resumeGroupRules(mutate, group, tap.ruleIds, tap.wording === "unblock" ? { name: tap.name, until: tap.liftedUntil ?? null } : undefined);
    }
    return openSheet({ kind: "rule", ruleIds: tap.ruleIds, name: tap.name, mode: tap.run === "extend" ? "extend" : "pause", ...(tap.wording ? { wording: tap.wording } : {}) });
  }
  switch (tap.run) {
    case "block":
      return openSheet({ kind: "block", mode: "pause" });
    case "moreBlock":
      return openSheet({ kind: "block", mode: "extend" });
    case "unblock":
      return openSheet({ kind: "unblock", mode: "pause" });
    case "moreUnblock":
      return openSheet({ kind: "unblock", mode: "extend" });
    case "unblockNow":
    case "resume":
      return void runGroupHeaderAction(mutate, group, tap.run);
    default:
      // A Block button rule's run without its rule has nothing to act on.
      return undefined;
  }
}
