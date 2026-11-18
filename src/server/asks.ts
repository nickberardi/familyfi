import { AskState, RuleMode, type Ask } from "@prisma/client";
import { z } from "zod";
import { recordAsk } from "./alerts/producers";
import type { SignedInSession } from "./auth";
import { groupForChild, requireChildReads } from "./child-day";
import { prisma } from "./db";
import { blockRuleOf, groupInclude, lifted, publicGroup, sessionActor } from "./groups";
import { loadHousehold } from "./household";
import { ApiError } from "./http";
import { activeWindowsEnd, builtInRule, ruleInternetWindows } from "./rules";

/*
 * Asking for more time (FamilyFi Me). A child's phone files an ask on its own group, or on a Things
 * group shared with children, to end the group's pause or to lift one rule's window for a number of
 * minutes. A parent answers no with
 * decline, or yes with the verb that lifts it: the group's `resume` on `internet` for a pause, the
 * rule's `allow` for the group for a window, each with the ask's `askId`. Any write that lifts what
 * a waiting ask is about answers it yes too, however the parent gave it (`answerAsks`).
 */

/** The fewest and most minutes a child can ask for. */
export const ASK_MINUTES = { min: 5, max: 240 } as const;
/** At most this many asks from one group an hour. */
export const ASKS_PER_HOUR = 6;
const HOUR_MS = 60 * 60_000;

export const AskBody = z.discriminatedUnion("about", [
  z.object({ about: z.literal("pause") }).strict(),
  z
    .object({ about: z.literal("rule"), ruleId: z.string().min(1), minutes: z.number().int().min(ASK_MINUTES.min).max(ASK_MINUTES.max) })
    .strict(),
]);

export type AskInput = z.infer<typeof AskBody>;

/** A waiting ask, not yet past its end. */
function open(now: Date) {
  return { state: AskState.waiting, expiresAt: { gt: now } };
}

/** Refuses anyone but FamilyFi Me on a child's phone, which alone asks for more time. */
export function requireChild(session: SignedInSession) {
  if (session.device?.clientType !== "me") throw new ApiError(403, "child_only", "Only FamilyFi Me on a child's phone asks for more time.");
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
    const block = blockRuleOf(group);
    if (!block?.enabled || (block.expiresAt !== null && block.expiresAt <= now)) {
      throw new ApiError(409, "not_blocked", thing ? `${thing} isn't blocked right now.` : "You aren't paused right now.");
    }
    blockEnd = block.expiresAt;
  } else {
    const link = group.rules.find((item) => item.ruleId === input.ruleId && item.rule.systemGroupId === null && !builtInRule(item.rule));
    if (!link) throw new ApiError(404, "not_found", thing ? `That rule isn't one of ${thing}'s.` : "That rule isn't one of yours.");
    const { rule } = link;
    if (rule.mode === RuleMode.always) throw new ApiError(409, "always_on", "You can't ask for more time on this one.");
    const ends = activeWindowsEnd(ruleInternetWindows(rule), now, household.timezone);
    if (!rule.enabled || lifted(rule, now) || lifted(link, now) || !ends) {
      throw new ApiError(409, "not_blocked", thing ? `That rule isn't blocking ${thing} right now.` : "That rule isn't blocking you right now.");
    }
    blockEnd = ends;
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
        minutes: input.about === "rule" ? input.minutes : null,
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
 * by that parent, whether or not they answered it by its id.
 */
export async function answerAsks(
  session: Parameters<typeof sessionActor>[0],
  groupId: string | null,
  lifted: { pause?: boolean; ruleIds?: string[] },
): Promise<void> {
  const about = [
    ...(lifted.pause ? [{ about: "pause" }] : []),
    ...(lifted.ruleIds?.length ? [{ about: "rule", ruleId: { in: lifted.ruleIds } }] : []),
  ];
  if (!about.length) return;
  const now = new Date();
  const by = sessionActor(session);
  await prisma().ask.updateMany({
    where: { ...(groupId ? { groupId } : {}), ...open(now), OR: about },
    data: { state: AskState.yes, answeredAt: now, answeredByAccountId: by.accountId, answeredByName: by.name },
  });
}

/**
 * A group's pause was set again or extended: a waiting ask to be unpaused now closes at the
 * earlier of the household's timeout and the pause's new end (`end` null: none).
 */
export async function followPause(groupId: string, end: Date | null): Promise<void> {
  const now = new Date();
  const waiting = await prisma().ask.findMany({ where: { groupId, about: "pause", ...open(now) } });
  if (!waiting.length) return;
  const { askTimeoutMinutes } = await loadHousehold();
  for (const ask of waiting) {
    const timeout = new Date(ask.createdAt.getTime() + askTimeoutMinutes * 60_000);
    const endsWithBlock = end !== null && end <= timeout;
    await prisma().ask.updateMany({ where: { id: ask.id, ...open(now) }, data: { expiresAt: endsWithBlock ? end : timeout, endsWithBlock } });
  }
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
