/**
 * Where each card of a stack sits, and how tall it is, for familyfi-mobile's stacked cards (the
 * Claude Design "FamilyFi Mobile" stack, `stackify`); the app moves the cards there on its springs.
 * Closed, the cards overlap like a wallet, each showing its head. Open, the chosen card shows all
 * of itself when it fits, the cards above it fold to a peek of their heads, and the cards under it
 * follow at their full peeks, past the room if need be, where the page scrolls to them.
 * Heights are measured, so the stack follows the platform's text size. The open card comes first:
 * the peeks above share what room it leaves, folding as thin as an edge when they must.
 */

/** Room above the first card, and below the last for its shadow. */
export const STACK_TOP = 4;
export const STACK_FOOT = 8;
/** How far each closed card tucks under the one in front of it. */
export const STACK_TUCK = 8;
/** How much of a peeking card's head the next card covers. */
export const PEEK_COVER = 22;
/** The gap between the open card and the peeks under it. */
export const PEEK_GAP = 6;
/** The open card is never shorter than its head and this much body, however little room there is, unless it measures shorter. */
export const MIN_BODY = 160;
/** Until its height is measured, an open card takes at least this share of the room. */
export const OPEN_SHARE = 0.6;
/** The thinnest a folded peek gets: an edge to tap. */
export const PEEK_MIN = 10;

export type CardFrame = { y: number; h: number };

/** A peeking card's visible part: its head, less what the card in front covers. */
export function peekOf(head: number): number {
  return Math.max(head - PEEK_COVER, Math.ceil(head * 0.6));
}

/**
 * Each card's frame and the stack's height. `heads` are the cards' head heights, `open` the open
 * card's index (null when the stack is closed), `room` the height the open card and the cards
 * above it fill (the cards under it may run past it), and `content` the open card's whole height (head, body and foot) once it is measured.
 */
export function stackLayout(
  heads: number[],
  open: number | null,
  room: number,
  content?: number,
): { frames: CardFrame[]; height: number } {
  const n = heads.length;
  if (n === 0) return { frames: [], height: 0 };
  if (open === null || open < 0 || open >= n) {
    let y = STACK_TOP;
    const frames = heads.map((head) => {
      const frame = { y, h: head };
      y += head - STACK_TUCK;
      return frame;
    });
    const last = frames[n - 1]!;
    return { frames, height: last.y + last.h + STACK_FOOT };
  }
  // The open card and the cards above it share the room; the cards under it keep their whole
  // peeks past the room, where the page scrolls to them (and on iOS shows them through the tab bar).
  // A measured card is as tall as it is, up to the room the cards above leave at their thinnest
  // peeks, and scrolls only past that.
  const most = room - 2 * STACK_TOP - PEEK_MIN * open;
  const fitted = content === undefined ? undefined : Math.min(content, Math.max(most, heads[open]! + MIN_BODY));
  // Peeks above that would crowd the open card fold thinner, all alike, to an edge at least. Nothing
  // covers the last card, so under the open card it shows its whole head.
  const natural = heads.map((head, index) => (index === n - 1 && index > open ? head : peekOf(head)));
  const aboveNatural = natural.slice(0, open).reduce((sum, peek) => sum + peek, 0);
  const openMin = fitted ?? Math.max(heads[open]! + MIN_BODY, room * OPEN_SHARE);
  const aboveRoom = room - 2 * STACK_TOP - openMin;
  const kept = new Set(natural.map((_, index) => index).filter((index) => index >= open));
  const peeks = aboveNatural <= aboveRoom ? natural : foldPeeks(natural, kept, Math.max(aboveRoom, 0));
  const above = peeks.slice(0, open).reduce((sum, peek) => sum + peek, 0);
  const openY = STACK_TOP + above;
  const left = Math.max(room - openY - STACK_TOP, heads[open]! + MIN_BODY);
  // Peeks of taller heads fold less than the cap allowed for, so the card also keeps to what they leave.
  const openH = fitted === undefined ? left : Math.min(fitted, left);
  const frames: CardFrame[] = [];
  let y = STACK_TOP;
  for (let index = 0; index < open; index += 1) {
    frames.push({ y, h: heads[index]! });
    y += peeks[index]!;
  }
  frames.push({ y: openY, h: openH });
  y = openY + openH + PEEK_GAP;
  for (let index = open + 1; index < n; index += 1) {
    frames.push({ y, h: heads[index]! });
    y += peeks[index]!;
  }
  const below = n - 1 - open;
  const height = (below ? y : openY + openH) + STACK_TOP;
  return { frames, height };
}

/**
 * The other cards' peeks folded alike into `room`, none thinner than an edge: a peek that would
 * fold past the edge keeps the edge, and the rest fold further to share what it leaves. `kept`
 * peeks (the open card's and those under it) stay as they are, outside `room`.
 */
function foldPeeks(natural: number[], kept: Set<number>, room: number): number[] {
  const edged = new Set<number>();
  let fold = 0;
  for (;;) {
    const free = natural.reduce((sum, peek, index) => (kept.has(index) || edged.has(index) ? sum : sum + peek), 0);
    fold = free > 0 ? Math.max(room - edged.size * PEEK_MIN, 0) / free : 0;
    const next = natural.findIndex((peek, index) => !kept.has(index) && !edged.has(index) && peek * fold < PEEK_MIN);
    if (next < 0) break;
    edged.add(next);
  }
  return natural.map((peek, index) => (kept.has(index) ? peek : edged.has(index) ? PEEK_MIN : Math.floor(peek * fold)));
}

/**
 * UIKit's rubber band: past an edge, a drag of `offset` moves `limit · (1 − 1 / (offset · 0.55 / limit + 1))`,
 * so it gives a little at first and less the further it goes.
 */
export function rubberBand(offset: number, limit: number): number {
  "worklet";
  if (offset <= 0 || limit <= 0) return 0;
  return limit * (1 - 1 / ((offset * 0.55) / limit + 1));
}

/** How far down an open card's head is dragged before letting go closes it, or how fast. */
export const DISMISS_DISTANCE = 90;
export const DISMISS_VELOCITY = 800;

/** Whether letting go of a drag `distance` down at `velocity` (points per second) closes the card. */
export function dismisses(distance: number, velocity: number): boolean {
  "worklet";
  return distance > DISMISS_DISTANCE || (distance > 12 && velocity > DISMISS_VELOCITY);
}
