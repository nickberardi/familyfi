import { groupDayOf, NO_END_TIME } from "./child-day";
import { formatClock, relativeDayLabel } from "./display";
import { HEADS_UP_DAYS, headsUpBlocks, type HeadsUpBlock } from "./heads-up";
import type { Rule } from "./rules";
import type { Group } from "./types";

/**
 * What changes next across the family, for a parent's watch face, Smart Stack card and Wear Tile
 * (docs/design.md, "A parent's watch: what changes next"). Each group's blocks come from the same plan
 * FamilyFi Me's heads-up uses (`groupDayOf`, `headsUpBlocks`), so a parent's watch and a person's
 * phone agree on when Bedtime starts; this only gathers them across groups and words them for a
 * parent, naming whose it is. The watches port it (Swift and Kotlin) and replay its vectors.
 */

/** How far ahead a parent's watch plans; it plans again each time it reads FamilyFi. */
export const FAMILY_NEXT_HOURS = 24;

/**
 * How long before a group's block starts its screen on a parent's watch counts down to it, and the
 * circular complication's ring fills: an hour, long enough to act on before it starts.
 */
export const FAMILY_COUNTDOWN_MINUTES = 60;

/** A block under way, or the change coming next, with the groups it is for (in the order given). */
export type FamilyItem = {
  /** "Bedtime", the window's name; "Block" for a group's own block (its pause); an always-on rule's name. */
  name: string;
  /** Whether it is a group's own block, which the watches draw with the block sign rather than the window's. */
  pause: boolean;
  /** The groups' names, as FamilyFi lists names: "Abby", "Abby and Cassie", "Abby, Betsy and Cassie". */
  who: string;
  groupIds: string[];
  /** When it ends (for a block under way) or happens (for a change); null: no end time. */
  at: string | null;
};

/**
 * One entry on the watch's timeline, shown from `from` until the next entry's. `next` is the change
 * the complication counts down to; `now` is every block under way.
 */
export type FamilyEntry = {
  from: string;
  now: FamilyItem[];
  next: (FamilyItem & { kind: "start" | "end" }) | null;
  /** The big line: "Bedtime", "Block", or "Nothing planned"; with a block on that has no end and nothing after it, that block. */
  title: string;
  /** "Abby and Cassie", or "" with nothing next. */
  who: string;
  /** "Starts at 9:00 PM", "Ends tomorrow at 7:00 AM", "Starts Sat at 10:00 AM", "No end time", or "" with nothing at all. */
  line: string;
  /**
   * The inline complication's words before its relative time: "Bedtime for Abby in", "Bedtime ends
   * for Abby in", "Block ends for Abby in"; with a block on that has no end, "Block for Abby"; with nothing
   * at all, "Nothing planned".
   */
  short: string;
  /** The same without names, for the face while the wrist is down: "Bedtime in", "Bedtime ends in". */
  privateShort: string;
  /** The plan ran out while windows go on: the face can't say what is next, and must not look open. */
  unknown: boolean;
};

/** The words the watches draw around these lines, in one place so Apple Watch and Wear say the same. */
export const FAMILY_NEXT_WORDS = {
  now: "Now",
  next: "Next",
  block: "Block",
  nothingPlanned: "Nothing planned",
  /** "Nothing planned" where a face has room for one short word (Wear's short text, a corner). */
  nothingShort: "None",
  /** "Not up to date" where a face has room for one short word. */
  unknownShort: "Update",
  unknownTitle: "Not up to date",
  unknownLine: "Open FamilyFi to update",
} as const;

type GroupBlock = { group: Pick<Group, "id" | "name">; block: HeadsUpBlock };

/**
 * The family's timeline from `now` for `hours`: one entry for now, then one at each start and each
 * end. When any group has scheduled windows, the last entry says the watch is not up to date rather
 * than "Nothing planned", since they go on past the plan.
 */
export function familyTimeline(groups: Group[], rules: Rule[], timeZone: string, now: Date, hours: number = FAMILY_NEXT_HOURS): FamilyEntry[] {
  const horizon = now.getTime() + hours * 3_600_000;
  const blocks: GroupBlock[] = groups.flatMap((group) =>
    // Planned at least two days past what it shows, and as far as FamilyFi Me's heads-up, so the last
    // entry still knows what comes after it and a weekly window is never read as nothing planned.
    headsUpBlocks(groupDayOf(group, rules, timeZone, now), now, Math.max(HEADS_UP_DAYS, (hours + 48) / 24)).map((block) => ({ group, block })),
  );
  const recurs = groups.some((group) => groupDayOf(group, rules, timeZone, now).windows.length > 0);
  const after = (times: (number | undefined)[]) => [...new Set(times)].filter((time): time is number => time !== undefined && time > now.getTime()).sort((a, b) => a - b);
  // A change is a block starting or ending; a block that ran into another also changes its name, which starts an entry but is no change.
  const changes = after(blocks.flatMap(({ block }) => [block.from.getTime(), block.to?.getTime()]));
  const shown = after([...changes, ...blocks.map(({ block }) => block.switchAt?.getTime())]).filter((time) => time < horizon);
  const entries = [now.getTime(), ...shown].map((at) => entryAt(blocks, at, changes.find((change) => change > at) ?? null, timeZone));
  if (recurs) entries.push(unknownEntry(horizon, blocks));
  return entries;
}

function entryAt(blocks: GroupBlock[], at: number, nextAt: number | null, timeZone: string): FamilyEntry {
  const under = blocks.filter(({ block }) => block.from.getTime() <= at && (block.to === null || block.to.getTime() > at));
  const now = gather(under.map(({ group, block }) => ({ group, ...nameAt(block, at), at: block.to })));
  const changes =
    nextAt === null
      ? []
      : [
          ...blocks.filter(({ block }) => block.to?.getTime() === nextAt).map(({ group, block }) => ({ group, kind: "end" as const, ...nameAt(block, nextAt - 1), at: block.to })),
          ...blocks.filter(({ block }) => block.from.getTime() === nextAt).map(({ group, block }) => ({ group, kind: "start" as const, ...nameAt(block, nextAt), at: block.from })),
        ];
  // A change at one instant can be several (Bedtime ends for one group as Homework starts for another): the first is told.
  const first = changes[0];
  const next = first ? { ...gather(changes.filter((change) => change.kind === first.kind && change.name === first.name && change.pause === first.pause))[0]!, kind: first.kind } : null;
  const base = { from: new Date(at).toISOString(), now, next, unknown: false };
  // A block with no end and nothing after it is told as itself: "Block for Abby", "No end time".
  const on = now[0];
  if (!next && on) return { ...base, title: on.name, who: on.who, line: NO_END_TIME, short: `${on.name} for ${on.who}`, privateShort: on.name };
  if (!next) return { ...base, title: FAMILY_NEXT_WORDS.nothingPlanned, who: "", line: "", short: FAMILY_NEXT_WORDS.nothingPlanned, privateShort: FAMILY_NEXT_WORDS.nothingPlanned };
  // "Starts at 9:00 PM" today, "Ends tomorrow at 7:00 AM", "Starts Sat at 10:00 AM".
  const when = new Date(next.at!);
  const day = relativeDayLabel(when, timeZone, new Date(at));
  const clock = `${day === "today" ? "" : `${day} `}at ${formatClock(when, timeZone)}`;
  const start = next.kind === "start";
  return {
    ...base,
    title: next.name,
    who: next.who,
    line: start ? `Starts ${clock}` : `Ends ${clock}`,
    short: start ? `${next.name} for ${next.who} in` : `${next.name} ends for ${next.who} in`,
    privateShort: start ? `${next.name} in` : `${next.name} ends in`,
  };
}

function unknownEntry(horizon: number, blocks: GroupBlock[]): FamilyEntry {
  const under = blocks.filter(({ block }) => block.from.getTime() <= horizon && (block.to === null || block.to.getTime() > horizon));
  return {
    from: new Date(horizon).toISOString(),
    now: gather(under.map(({ group, block }) => ({ group, ...nameAt(block, horizon), at: block.to }))),
    next: null,
    title: FAMILY_NEXT_WORDS.unknownTitle,
    who: "",
    line: FAMILY_NEXT_WORDS.unknownLine,
    short: FAMILY_NEXT_WORDS.unknownTitle,
    privateShort: FAMILY_NEXT_WORDS.unknownTitle,
    unknown: true,
  };
}

/** A block's name at `at`: a block that ran into another is told as the first until it ends, then as the one that ends it. */
function nameAt(block: HeadsUpBlock, at: number): { name: string; pause: boolean } {
  const switched = block.switchAt !== null && at >= block.switchAt.getTime();
  const pause = switched ? block.endPause : block.pause;
  return { name: pause ? FAMILY_NEXT_WORDS.block : switched ? block.endName : block.name, pause };
}

/** Blocks with the same name, kind of block and time, as one item naming every group. */
function gather(items: { group: Pick<Group, "id" | "name">; name: string; pause: boolean; at: Date | null }[]): FamilyItem[] {
  const out: (FamilyItem & { groups: string[] })[] = [];
  for (const item of items) {
    const at = item.at?.toISOString() ?? null;
    const same = out.find((entry) => entry.name === item.name && entry.pause === item.pause && entry.at === at);
    if (same) {
      if (!same.groupIds.includes(item.group.id)) {
        same.groupIds.push(item.group.id);
        same.groups.push(item.group.name);
      }
    } else out.push({ name: item.name, pause: item.pause, who: "", groupIds: [item.group.id], groups: [item.group.name], at });
  }
  return out.map(({ groups, ...entry }) => ({ ...entry, who: names(groups) }));
}

function names(items: string[]): string {
  const unique = [...new Set(items)];
  return unique.length <= 1 ? (unique[0] ?? "") : `${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}`;
}
