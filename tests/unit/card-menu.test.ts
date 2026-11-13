import { describe, expect, it } from "vitest";

import { CARD_MENU_EDGE, CARD_MENU_GAP, CARD_MENU_ROW_MIN, cardMenuPlacement } from "@/lib/card-menu";

describe("card dropdown on a phone", () => {
  it("keeps every row at the 44 pt touch floor", () => {
    expect(CARD_MENU_ROW_MIN).toBe(44);
  });

  it("hangs under the button, lined up with its outer edge", () => {
    const button = { x: 250, y: 120, width: 110, height: 32 };
    expect(cardMenuPlacement(button, { width: 390, height: 844 }, "right")).toEqual({ top: 120 + 32 + CARD_MENU_GAP, right: 30 });
    expect(cardMenuPlacement(button, { width: 390, height: 844 }, "left")).toEqual({ top: 158, left: 250 });
  });

  it("never places the dropdown off the screen's edge", () => {
    const wide = { x: -4, y: 0, width: 400, height: 32 };
    expect(cardMenuPlacement(wide, { width: 390, height: 844 }, "right")).toEqual({ top: 38, right: 0 });
    expect(cardMenuPlacement(wide, { width: 390, height: 844 }, "left")).toEqual({ top: 38, left: 0 });
  });

  it("opens above the button when it would run past the bottom of the screen", () => {
    const low = { x: 250, y: 700, width: 110, height: 32 };
    // Three 44 pt rows and their borders.
    expect(cardMenuPlacement(low, { width: 390, height: 844 }, "right", 134)).toEqual({ top: 700 - CARD_MENU_GAP - 134, right: 30 });
    // A short dropdown that still fits stays under the button.
    expect(cardMenuPlacement(low, { width: 390, height: 844 }, "right", 46)).toEqual({ top: 738, right: 30 });
  });

  it("never starts above the top of the screen, and picks the side with more room", () => {
    // A landscape phone: little room above or below a button in the middle.
    const middle = { x: 600, y: 150, width: 110, height: 32 };
    expect(cardMenuPlacement(middle, { width: 844, height: 390 }, "left", 230)).toEqual({ top: 188, left: 600 });
    const lower = { x: 600, y: 250, width: 110, height: 32 };
    expect(cardMenuPlacement(lower, { width: 844, height: 390 }, "left", 230)).toEqual({ top: CARD_MENU_EDGE, left: 600 });
  });
});
