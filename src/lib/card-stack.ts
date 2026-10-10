/**
 * Where each card of a stack sits, and how tall it is, for familyfi-mobile's stacked cards (the
 * Claude Design "FamilyFi Mobile" stack, `stackify`); the app moves the cards there on its springs.
 * Closed, the cards overlap like a wallet, each showing its head. Open, the chosen card fills the
 * room it is given, and the others fold to a peek of their heads above and below it.
 * Heights are measured heads, so the stack follows the platform's text size. In a long stack the
 * peeks fold thinner, so the open card keeps most of the room.
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
/** The open card is never shorter than its head and this much body, however little room there is. */
export const MIN_BODY = 160;
/** A long stack folds its peeks thinner so the open card keeps this share of the room. */
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
 * card's index (null when the stack is closed), and `room` the height the stack may fill while one
 * is open.
 */
export function stackLayout(
  heads: number[],
  open: number | null,
  room: number,
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
  // Peeks that would crowd the open card fold thinner, all alike, to an edge at least.
  const natural = heads.map(peekOf);
  const others = natural.reduce((sum, peek) => sum + peek, 0) - natural[open]!;
  const openMin = Math.max(heads[open]! + MIN_BODY, room * OPEN_SHARE);
  const peekRoom = room - 2 * STACK_TOP - (open < n - 1 ? PEEK_GAP : 0) - openMin;
  const fold = others > peekRoom ? Math.max(peekRoom, 0) / others : 1;
  const peeks = natural.map((peek) => (fold < 1 ? Math.max(Math.floor(peek * fold), PEEK_MIN) : peek));
  const above = peeks.slice(0, open).reduce((sum, peek) => sum + peek, 0);
  const below = peeks.slice(open + 1);
  const belowRoom = below.reduce((sum, peek) => sum + peek, 0) + (below.length ? PEEK_GAP : 0);
  const openY = STACK_TOP + above;
  const openH = Math.max(room - openY - STACK_TOP - belowRoom, heads[open]! + MIN_BODY);
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
  const height = (below.length ? y : openY + openH) + STACK_TOP;
  return { frames, height };
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
