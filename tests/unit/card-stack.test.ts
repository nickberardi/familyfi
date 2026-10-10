import { describe, expect, it } from "vitest";

import {
  DISMISS_DISTANCE,
  MIN_BODY,
  OPEN_SHARE,
  PEEK_MIN,
  PEEK_GAP,
  STACK_FOOT,
  STACK_TOP,
  dismisses,
  peekOf,
  rubberBand,
  stackLayout,
} from "@/lib/card-stack";

// The design's closed card: 84 pt, each tucked 8 under the next (a 76 pt step), peeking 62 open.
const heads = [84, 84, 84, 84];

describe("the card stack's layout", () => {
  it("overlaps closed cards a step apart, as the design's wallet does", () => {
    const { frames, height } = stackLayout(heads, null, 600);
    expect(frames.map((frame) => frame.y)).toEqual([4, 80, 156, 232]);
    expect(frames.every((frame) => frame.h === 84)).toBe(true);
    expect(height).toBe(232 + 84 + STACK_FOOT);
    expect(peekOf(84)).toBe(62);
  });

  it("opens the first card to fill the room, with the rest peeking under it", () => {
    const { frames, height } = stackLayout(heads, 0, 600);
    // Three peeks of 62 and the gap below the open card.
    const openH = 600 - STACK_TOP - STACK_TOP - 3 * 62 - PEEK_GAP;
    expect(frames[0]).toEqual({ y: 4, h: openH });
    expect(frames.slice(1).map((frame) => frame.y)).toEqual([4 + openH + 6, 4 + openH + 6 + 62, 4 + openH + 6 + 124]);
    expect(height).toBe(600);
  });

  it("opens a middle card between peeks above and below", () => {
    const { frames, height } = stackLayout(heads, 2, 600);
    expect(frames[0]!.y).toBe(4);
    expect(frames[1]!.y).toBe(66);
    const open = frames[2]!;
    expect(open.y).toBe(4 + 2 * 62);
    expect(open.h).toBe(600 - open.y - STACK_TOP - 62 - PEEK_GAP);
    expect(frames[3]!.y).toBe(open.y + open.h + PEEK_GAP);
    // Above-cards keep their full head, so the next card covers all but the peek.
    expect(frames[1]!.h).toBe(84);
    expect(height).toBe(600);
  });

  it("opens the last card with every other card peeking above", () => {
    const { frames, height } = stackLayout(heads, 3, 600);
    const open = frames[3]!;
    expect(open.y).toBe(4 + 3 * 62);
    expect(open.y + open.h + STACK_TOP).toBe(600);
    expect(height).toBe(600);
  });

  it("opens a single card to the room it has", () => {
    expect(stackLayout([84], 0, 500)).toEqual({ frames: [{ y: 4, h: 492 }], height: 500 });
    expect(stackLayout([84], null, 500)).toEqual({ frames: [{ y: 4, h: 84 }], height: 4 + 84 + STACK_FOOT });
    expect(stackLayout([], null, 500)).toEqual({ frames: [], height: 0 });
  });

  it("follows measured heads at large text sizes", () => {
    const large = [140, 120, 160];
    const closed = stackLayout(large, null, 700);
    expect(closed.frames.map((frame) => frame.y)).toEqual([4, 4 + 132, 4 + 132 + 112]);
    const open = stackLayout(large, 1, 700);
    expect(open.frames[1]!.y).toBe(4 + peekOf(140));
    expect(open.frames[2]!.y).toBe(open.frames[1]!.y + open.frames[1]!.h + PEEK_GAP);
    // A tall head still peeks more than half of itself.
    expect(peekOf(160)).toBe(138);
    expect(peekOf(30)).toBe(18);
  });

  it("keeps the open card readable when the room is too small, growing the stack instead", () => {
    const { frames, height } = stackLayout(heads, 1, 200);
    expect(frames[1]!.h).toBe(84 + MIN_BODY);
    expect(height).toBeGreaterThan(200);
  });

  it("treats an open index outside the stack as closed", () => {
    expect(stackLayout(heads, 9, 600)).toEqual(stackLayout(heads, null, 600));
    expect(stackLayout(heads, -1, 600)).toEqual(stackLayout(heads, null, 600));
  });
});

describe("dragging an open card", () => {
  it("closes past the distance, or on a quick flick, and springs back otherwise", () => {
    expect(dismisses(DISMISS_DISTANCE + 1, 0)).toBe(true);
    expect(dismisses(DISMISS_DISTANCE - 1, 0)).toBe(false);
    expect(dismisses(30, 1200)).toBe(true);
    // A flick that barely moved is a tap that wobbled.
    expect(dismisses(4, 1200)).toBe(false);
    expect(dismisses(30, -1200)).toBe(false);
  });

  it("gives less the further it is pulled past the edge, never reaching the limit", () => {
    expect(rubberBand(0, 60)).toBe(0);
    expect(rubberBand(-10, 60)).toBe(0);
    const near = rubberBand(20, 60);
    const far = rubberBand(200, 60);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(20);
    expect(far).toBeGreaterThan(near);
    expect(far).toBeLessThan(60);
  });
});

describe("a long stack", () => {
  const many = Array.from({ length: 13 }, () => 84);

  it("folds its peeks thinner so the open card keeps most of the room", () => {
    const { frames, height } = stackLayout(many, 12, 620);
    const open = frames[12]!;
    expect(open.h).toBeGreaterThanOrEqual(620 * OPEN_SHARE);
    expect(open.y + open.h + STACK_TOP).toBe(620);
    expect(height).toBe(620);
    // Every peek above is the same, and thinner than the design's 62.
    const steps = frames.slice(1, 12).map((frame, index) => frame.y - frames[index]!.y);
    expect(new Set(steps).size).toBe(1);
    expect(steps[0]).toBeLessThan(62);
    expect(steps[0]).toBeGreaterThanOrEqual(PEEK_MIN);
  });

  it("never folds a peek past an edge to tap, growing the stack instead", () => {
    const { frames, height } = stackLayout(
      Array.from({ length: 60 }, () => 84),
      30,
      620,
    );
    const steps = frames.slice(1, 30).map((frame, index) => frame.y - frames[index]!.y);
    expect(Math.min(...steps)).toBe(PEEK_MIN);
    expect(height).toBeGreaterThan(620);
  });
});
