import { AskState, RuleMode, type Ask } from "@prisma/client";
import { z } from "zod";
import { recordAsk } from "./alerts/producers";
import type { SignedInSession } from "./auth";
import { groupForChild } from "./child-day";
import { prisma } from "./db";
import { blockRuleOf, groupInclude, lifted, publicGroup, sessionActor } from "./groups";
import { loadHousehold } from "./household";
import { ApiError } from "./http";
import { activeWindowsEnd, builtInRule, ruleInternetWindows } from "./rules";

/*
 * Asking for more time (FamilyFi Me). A child's phone files an ask on its own group, to end the
 * group's pause or to lift one rule's window for a number of minutes. A parent answers no with
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

/** Files a child's ask on its own group. Only FamilyFi Me asks, and only for its own group. */
export async function fileAsk(session: SignedInSession, groupId: string, input: AskInput) {
  const device = requireChild(session);
  if (groupId !== device.groupId) throw new ApiError(404, "not_found", "Group not found.");
  const group = await prisma().group.findUnique({ where: { id: groupId }, include: groupInclude });
  if (!group) throw new ApiError(404, "not_found", "Group not found.");
  const household = await loadHousehold();
  const now = new Date();

  // What blocks the child now, and when it ends on its own; null: it has no end.
  let blockEnd: Date | null;
  let ruleName: string | undefined;
  if (input.about === "pause") {
    const block = blockRuleOf(group);
    if (!block?.enabled || (block.expiresAt !== null && block.expiresAt <= now)) throw new ApiError(409, "not_blocked", "This group isn't paused.");
    blockEnd = block.expiresAt;
  } else {
    const link = group.rules.find((item) => item.ruleId === input.ruleId && item.rule.systemGroupId === null && !builtInRule(item.rule));
    if (!link) throw new ApiError(404, "not_found", "That rule doesn't cover this group.");
    const { rule } = link;
    if (rule.mode === RuleMode.always) throw new ApiError(409, "always_on", "An always-on rule isn't lifted by asking.");
    const ends = activeWindowsEnd(ruleInternetWindows(rule), now, household.timezone);
    if (!rule.enabled || lifted(rule, now) || lifted(link, now) || !ends) throw new ApiError(409, "not_blocked", "This rule isn't blocking this group now.");
    blockEnd = ends;
    ruleName = rule.name;
  }
  const timeout = new Date(now.getTime() + household.askTimeoutMinutes * 60_000);
  const endsWithBlock = blockEnd !== null && blockEnd <= timeout;

  const ask = await prisma().$transaction(async (tx) => {
    // One ask at a time for a group: two phones asking at once wait on its row.
    await tx.$queryRaw`SELECT "id" FROM "Group" WHERE "id" = ${groupId} FOR UPDATE`;
    if (await tx.ask.findFirst({ where: { groupId, ...open(now) } })) throw new ApiError(409, "ask_waiting", "An ask is already waiting for an answer.");
    const no = await tx.ask.findFirst({ where: { groupId, state: AskState.no, askAgainAt: { gt: now } } });
    if (no) throw new ApiError(409, "ask_too_soon", "A parent said not this time. Ask again later.");
    const recent = await tx.ask.count({ where: { groupId, createdAt: { gt: new Date(now.getTime() - HOUR_MS) } } });
    if (recent >= ASKS_PER_HOUR) throw new ApiError(429, "too_many_asks", "That's a lot of asks. Try again later.");
    return tx.ask.create({
      data: {
        groupId,
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
  await recordAsk({ groupId, groupName: group.name, about: input.about, ruleName, minutes: ask.minutes ?? undefined }, now);
  const fresh = await prisma().group.findUniqueOrThrow({ where: { id: groupId }, include: groupInclude });
  return { group: await groupForChild(publicGroup(fresh, household.timezone, now)) };
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

/** The sync pass's sweep: an ask left waiting past its end closes, `ended` with its block, else `timedOut`. */
export async function closeLapsedAsks(now: Date): Promise<void> {
  const lapsed = { state: AskState.waiting, expiresAt: { lte: now } };
  await prisma().ask.updateMany({ where: { ...lapsed, endsWithBlock: true }, data: { state: AskState.ended } });
  await prisma().ask.updateMany({ where: { ...lapsed, endsWithBlock: false }, data: { state: AskState.timedOut } });
}
