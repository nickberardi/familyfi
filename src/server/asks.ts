import { AskState, GroupKind, RuleMode, type Ask } from "@prisma/client";
import { isPersonDevice } from "@/lib/client-type";
import { z } from "zod";
import { ASK_MINUTES } from "@/lib/child-day";
import { recordAsk } from "./alerts/producers";
import type { SignedInSession } from "./auth";
import { groupForChild, requireChildReads } from "./child-day";
import { prisma } from "./db";
import { groupInclude, type GroupWithRules, lifted, publicGroup, sessionActor } from "./groups";
import { loadHousehold } from "./household";
import { ApiError } from "./http";
import { askableWindows, builtInRule, ruleInternetWindows } from "./rules";
import { unblockTargets } from "./unblock-targets";

/*
 * Asking for more time (FamilyFi Me). A child's phone files an ask on its own group, or on a Things
 * group shared with children, to unblock it (while it is paused, or a Thing's Block button rule
 * blocks it) or to lift one rule's window for a number of minutes. A parent answers no with
 * decline, or yes with what lifts it: for an ask to unblock, whatever the group's own Unblock
 * button sends (its unblock, or the Block button rule lifted for it), for a window the rule's
 * `allow` for the group with the ask's `askId`. Any write that lifts what a waiting ask is about
 * answers it yes, however the parent gave it (`answerAsks`); `resume` on `internet` with `askId`
 * still answers an ask to unblock that only a pause is behind.
 */

/** At most this many asks an hour from one child about one group. */
export const ASKS_PER_HOUR = 6;
const HOUR_MS = 60 * 60_000;

export const AskBody = z.discriminatedUnion("about", [
  // How long the child asks to be unblocked for, optional: a parent's yes may still end the block outright.
  z.object({ about: z.literal("pause"), minutes: z.number().int().min(ASK_MINUTES.min).max(ASK_MINUTES.max).optional() }).strict(),
  z
    .object({ about: z.literal("rule"), ruleId: z.string().min(1), minutes: z.number().int().min(ASK_MINUTES.min).max(ASK_MINUTES.max) })
    .strict(),
]);

export type AskInput = z.infer<typeof AskBody>;

/** A waiting ask, not yet past its end. */
function open(now: Date) {
  return { state: AskState.waiting, expiresAt: { gt: now } };
}

/**
 * When what an ask to unblock is about ends on its own: the later of the group's pause and, on a
 * Thing, its Block button rule's window (a child's own phone shows only its pause, `groupDayOf`);
 * null when either has no end, undefined when neither blocks it now.
 */
function unblockAskEnd(group: GroupWithRules, now: Date, timezone: string): Date | null | undefined {
  const { block, blockedByPause, buttonRuleId, candidates, ends } = unblockTargets(group, now, timezone);
  const button = group.kind === GroupKind.things ? candidates.find(({ rule, ...link }) => rule.id === buttonRuleId && !lifted(link, now)) : undefined;
  const buttonEnd = button ? ends.get(button.rule.id) : undefined;
  if (!blockedByPause && buttonEnd === undefined) return undefined;
  const lasts = [...(blockedByPause ? [block!.expiresAt] : []), ...(buttonEnd !== undefined ? [buttonEnd] : [])];
  return lasts.some((end) => end === null) ? null : new Date(Math.max(...lasts.map((end) => end!.getTime())));
}

/**
 * Whether a Thing's Block button rule blocks it now, besides any pause: then a resume ends the
 * pause alone, so it never answers the group's ask to unblock by its id (`liftForAsk`).
 */
export function blockedBeyondPause(group: GroupWithRules, now: Date, timezone: string): boolean {
  const { buttonRuleId, candidates, ends } = unblockTargets(group, now, timezone);
  if (group.kind !== GroupKind.things) return false;
  const button = candidates.find(({ rule, ...link }) => rule.id === buttonRuleId && !lifted(link, now));
  return button !== undefined && ends.get(button.rule.id) !== undefined;
}

/** Refuses anyone but FamilyFi Me on a child's phone, which alone asks for more time. */
export function requireChild(session: SignedInSession) {
  if (!isPersonDevice(session.device)) throw new ApiError(403, "child_only", "Only FamilyFi Me on a child's phone asks for more time.");
  return session.device;
}

/**
 * Files a child's ask on its own group, or on a Things group shared with children (`kidsCanAsk`).
 * Only FamilyFi Me asks. A group, the child's own or a Thing, has one waiting ask at a time, which a
 * parent answers once; the wait after a no and the hourly limit are each child's own.
 */
export async function fileAsk(session: SignedInSession, groupId: string, input: AskInput) {
  const device = requireChild(session);
  const fromGroupId = device.groupId;
  if (!fromGroupId) throw new ApiError(404, "not_found", "Group not found.");
  await requireChildReads(fromGroupId, groupId);
  const group = await prisma().group.findUnique({ where: { id: groupId }, include: groupInclude });
  if (!group) throw new ApiError(404, "not_found", "Group not found.");
  // A Thing's words name it; the child's own group is "you".
  const thing = groupId !== fromGroupId ? group.name : null;
  const household = await loadHousehold();
  const now = new Date();

  // What blocks the child now, and when it ends on its own; null: it has no end.
  let blockEnd: Date | null;
  let ruleName: string | undefined;
  if (input.about === "pause") {
    // An ask to unblock is the group's Unblock: it may be asked while the group is paused, or while
    // its Block button rule blocks it (Video on TV), and it ends with the last of them.
    const end = unblockAskEnd(group, now, household.timezone);
    if (end === undefined) throw new ApiError(409, "not_blocked", thing ? `${thing} isn't blocked right now.` : "You aren't paused right now.");
    blockEnd = end;
  } else {
    const link = group.rules.find((item) => item.ruleId === input.ruleId && item.rule.systemGroupId === null && !builtInRule(item.rule));
    if (!link) throw new ApiError(404, "not_found", thing ? `That rule doesn't cover ${thing}.` : "That rule isn't one of yours.");
    const { rule } = link;
    if (rule.mode === RuleMode.always) throw new ApiError(409, "always_on", "You can't ask for more time on this one.");
    // A window on now, or one starting within the heads-up's five minutes (familyfi issue 457).
    const window = askableWindows(ruleInternetWindows(rule), now, household.timezone, household.askAheadMinutes);
    if (!rule.enabled || lifted(rule, now) || lifted(link, now) || !window?.end) {
      throw new ApiError(409, "not_blocked", thing ? `That rule isn't blocking ${thing} right now.` : "That rule isn't blocking you right now.");
    }
    blockEnd = window.end;
    ruleName = rule.name;
  }
  const timeout = new Date(now.getTime() + household.askTimeoutMinutes * 60_000);
  const endsWithBlock = blockEnd !== null && blockEnd <= timeout;

  const ask = await prisma().$transaction(async (tx) => {
    // One ask at a time for a group: two phones asking at once wait on its row.
    await tx.$queryRaw`SELECT "id" FROM "Group" WHERE "id" = ${groupId} FOR UPDATE`;
    const waiting = await tx.ask.findFirst({ where: { groupId, ...open(now) } });
    if (waiting) {
      // On a Thing, another child may have asked first: a parent answers that one.
      const someoneElse = waiting.fromGroupId !== fromGroupId;
      throw new ApiError(409, "ask_waiting", someoneElse ? `Someone already asked about ${thing ?? group.name}. Waiting for an answer.` : "You already asked. Waiting for an answer.");
    }
    const no = await tx.ask.findFirst({ where: { groupId, fromGroupId, state: AskState.no, askAgainAt: { gt: now } } });
    if (no) throw new ApiError(409, "ask_too_soon", "Not this time. You can ask again later.");
    const recent = await tx.ask.count({ where: { groupId, fromGroupId, createdAt: { gt: new Date(now.getTime() - HOUR_MS) } } });
    if (recent >= ASKS_PER_HOUR) throw new ApiError(429, "too_many_asks", "You've asked a lot this hour. Try again later.");
    return tx.ask.create({
      data: {
        groupId,
        fromGroupId,
        deviceId: session.deviceId,
        about: input.about,
        ruleId: input.about === "rule" ? input.ruleId : null,
        minutes: input.minutes ?? null,
        createdAt: now,
        expiresAt: endsWithBlock ? blockEnd! : timeout,
        endsWithBlock,
      },
    });
  });
  const child = thing ? await prisma().group.findUnique({ where: { id: fromGroupId }, select: { name: true } }) : group;
  await recordAsk(
    { groupId, groupName: child?.name ?? group.name, ...(thing ? { thingName: thing } : {}), about: input.about, ruleName, minutes: ask.minutes ?? undefined },
    now,
  );
  const fresh = await prisma().group.findUniqueOrThrow({ where: { id: groupId }, include: groupInclude });
  return { group: await groupForChild(publicGroup(fresh, household.timezone, now), fromGroupId) };
}

/** A parent's Not now: the ask closes, and the child can ask again after the household's wait. */
export async function declineAsk(session: SignedInSession, groupId: string, askId: string) {
  const ask = await prisma().ask.findUnique({ where: { id: askId } });
  if (!ask || ask.groupId !== groupId) throw new ApiError(404, "not_found", "Ask not found.");
  const household = await loadHousehold();
  const now = new Date();
  const by = sessionActor(session);
  const closed = await prisma().ask.updateMany({
    where: { id: askId, ...open(now) },
    data: {
      state: AskState.no,
      answeredAt: now,
      answeredByAccountId: by.accountId,
      answeredByName: by.name,
      askAgainAt: new Date(now.getTime() + household.askWaitMinutes * 60_000),
    },
  });
  if (!closed.count) throw askClosed();
  const fresh = await prisma().group.findUniqueOrThrow({ where: { id: groupId }, include: groupInclude });
  return { group: publicGroup(fresh, household.timezone, now) };
}

function askClosed() {
  return new ApiError(409, "ask_closed", "This ask has already been answered or has closed.");
}

/**
 * Takes a waiting ask for the yes a parent is giving it with `askId`, before the write that gives
 * it, so two parents answering at once cannot both say yes; `releaseAsk` puts it back when that
 * write fails. The ask must be on `groupId` and about what the verb lifts.
 */
export async function claimAsk(session: Parameters<typeof sessionActor>[0], askId: string, target: { groupId: string; about: "pause" | "rule"; ruleId?: string }): Promise<Ask> {
  const ask = await prisma().ask.findUnique({ where: { id: askId } });
  if (!ask || ask.groupId !== target.groupId) throw new ApiError(404, "not_found", "Ask not found.");
  if (ask.about !== target.about || (target.about === "rule" && ask.ruleId !== target.ruleId)) {
    throw new ApiError(400, "invalid_request", "This ask is about something else.");
  }
  const now = new Date();
  const by = sessionActor(session);
  const claimed = await prisma().ask.updateMany({
    where: { id: askId, ...open(now) },
    data: { state: AskState.yes, answeredAt: now, answeredByAccountId: by.accountId, answeredByName: by.name },
  });
  if (!claimed.count) throw askClosed();
  return ask;
}

export async function releaseAsk(askId: string): Promise<void> {
  await prisma().ask.updateMany({
    where: { id: askId, state: AskState.yes },
    data: { state: AskState.waiting, answeredAt: null, answeredByAccountId: null, answeredByName: null },
  });
}

/**
 * A parent's write lifted a group's pause (`pause`) or rules (`ruleIds`), for one group or, with
 * `groupId` null, every group a rule covers: each waiting ask about what was lifted is answered yes,
 * by that parent, whether or not they answered it by its id. An ask to unblock is answered only once
 * nothing it is about blocks the group: neither its pause nor its Block button rule.
 */
export async function answerAsks(
  session: Parameters<typeof sessionActor>[0],
  groupId: string | null,
  lifted: { pause?: boolean; ruleIds?: string[] },
): Promise<void> {
  const now = new Date();
  const by = sessionActor(session);
  const yes = { state: AskState.yes, answeredAt: now, answeredByAccountId: by.accountId, answeredByName: by.name };
  if (lifted.ruleIds?.length) {
    await prisma().ask.updateMany({ where: { ...(groupId ? { groupId } : {}), ...open(now), about: "rule", ruleId: { in: lifted.ruleIds } }, data: yes });
  }
  // A rule lifted may be a group's Block button rule, which an ask to unblock is about too.
  if (!lifted.pause && !lifted.ruleIds?.length) return;
  const waiting = await prisma().ask.findMany({ where: { ...(groupId ? { groupId } : {}), about: "pause", ...open(now) }, select: { groupId: true } });
  if (!waiting.length) return;
  const { timezone } = await loadHousehold();
  for (const id of new Set(waiting.map((ask) => ask.groupId))) {
    const group = await prisma().group.findUnique({ where: { id }, include: groupInclude });
    // Something it is about still blocks: the ask waits, closing when that does.
    if (group && unblockAskEnd(group, now, timezone) !== undefined) {
      await followPause(id);
      continue;
    }
    await prisma().ask.updateMany({ where: { groupId: id, about: "pause", ...open(now) }, data: yes });
  }
}

/**
 * A group's pause was set again or extended, or part of what blocks it was lifted: a waiting ask to
 * unblock now closes at the earlier of the household's timeout and the end of what it is about, its
 * pause or its Block button rule.
 */
export async function followPause(groupId: string): Promise<void> {
  const now = new Date();
  const waiting = await prisma().ask.findMany({ where: { groupId, about: "pause", ...open(now) } });
  if (!waiting.length) return;
  const { askTimeoutMinutes, timezone } = await loadHousehold();
  const group = await prisma().group.findUnique({ where: { id: groupId }, include: groupInclude });
  const end = group ? unblockAskEnd(group, now, timezone) : undefined;
  for (const ask of waiting) {
    const timeout = new Date(ask.createdAt.getTime() + askTimeoutMinutes * 60_000);
    const endsWithBlock = end !== null && end !== undefined && end <= timeout;
    await prisma().ask.updateMany({ where: { id: ask.id, ...open(now) }, data: { expiresAt: endsWithBlock ? end : timeout, endsWithBlock } });
  }
}

/**
 * A group unblocked or blocked again by a parent's write (paused, resumed, unblocked, or its Block
 * button rule lifted or put back) is newer than any yes that unblocked it before: that yes ends, so
 * the child's day tells only the newest unblock and never one from before a later block. `keep` is
 * the ask this write answers by its id, already taken as yes (`claimAsk`).
 */
export async function endEarlierUnblockYes(groupIds: string | string[], keep?: string): Promise<void> {
  const ids = typeof groupIds === "string" ? [groupIds] : groupIds;
  if (!ids.length) return;
  await prisma().ask.updateMany({
    where: { groupId: { in: ids }, about: "pause", state: AskState.yes, ...(keep ? { id: { not: keep } } : {}) },
    data: { state: AskState.ended },
  });
}

/** Asks are kept a week, well past the day a group shows its latest. */
const ASK_KEPT_MS = 7 * 24 * 60 * 60_000;

/**
 * The sync pass's sweep: an ask left waiting past its end closes, `ended` with its block, else
 * `timedOut`, and asks older than a week go.
 */
export async function closeLapsedAsks(now: Date): Promise<void> {
  await prisma().ask.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - ASK_KEPT_MS) } } });
  const lapsed = { state: AskState.waiting, expiresAt: { lte: now } };
  await prisma().ask.updateMany({ where: { ...lapsed, endsWithBlock: true }, data: { state: AskState.ended } });
  await prisma().ask.updateMany({ where: { ...lapsed, endsWithBlock: false }, data: { state: AskState.timedOut } });
}
