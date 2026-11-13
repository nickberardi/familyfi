import { describe, expect, it } from "vitest";

import { CARD_MENU_EDGE, CARD_MENU_GAP, CARD_MENU_ROW_MIN, cardMenuPlacement } from "@/lib/card-menu";

const phone = { width: 390, height: 844 };
const landscape = { width: 844, height: 390 };
const maxHeight = phone.height - 2 * CARD_MENU_EDGE;

/** The dropdown's top and bottom stay `CARD_MENU_EDGE` clear of the screen's edges. */
function onScreen(placement: { top: number; maxHeight: number }, window: { height: number }, menuHeight: number) {
  const height = Math.min(menuHeight, placement.maxHeight);
  return placement.top >= CARD_MENU_EDGE && placement.top + height <= window.height - CARD_MENU_EDGE;
}

describe("card dropdown on a phone", () => {
  it("keeps every row at the 44 pt touch floor", () => {
    expect(CARD_MENU_ROW_MIN).toBe(44);
  });

  it("hangs under the button, lined up with its outer edge", () => {
    const button = { x: 250, y: 120, width: 110, height: 32 };
    expect(cardMenuPlacement(button, phone, "right")).toEqual({ top: 120 + 32 + CARD_MENU_GAP, right: 30, maxHeight });
    expect(cardMenuPlacement(button, phone, "left")).toEqual({ top: 158, left: 250, maxHeight });
  });

  it("never places the dropdown off the screen's side", () => {
    const wide = { x: -4, y: 100, width: 400, height: 32 };
    expect(cardMenuPlacement(wide, phone, "right")).toMatchObject({ right: 0 });
    expect(cardMenuPlacement(wide, phone, "left")).toMatchObject({ left: 0 });
  });

  it("opens above the button when it would run past the bottom of the screen", () => {
    const low = { x: 250, y: 700, width: 110, height: 32 };
    // Three 44 pt rows and their borders.
    expect(cardMenuPlacement(low, phone, "right", 134)).toEqual({ top: 700 - CARD_MENU_GAP - 134, right: 30, maxHeight });
    // A short dropdown that still fits stays under the button.
    expect(cardMenuPlacement(low, phone, "right", 46)).toEqual({ top: 738, right: 30, maxHeight });
  });

  it("keeps every row on the screen when it fits on neither side of the button", () => {
    for (const y of [60, 150, 179, 250, 330]) {
      const button = { x: 600, y, width: 110, height: 32 };
      for (const menuHeight of [46, 134, 230, 302]) {
        const placement = cardMenuPlacement(button, landscape, "left", menuHeight);
        expect(onScreen(placement, landscape, menuHeight), `button at ${y}, dropdown ${menuHeight} tall`).toBe(true);
      }
    }
  });

  it("scrolls a dropdown taller than the screen instead of leaving rows out of reach", () => {
    const button = { x: 600, y: 150, width: 110, height: 32 };
    const placement = cardMenuPlacement(button, landscape, "left", 600);
    expect(placement).toEqual({ top: CARD_MENU_EDGE, left: 600, maxHeight: landscape.height - 2 * CARD_MENU_EDGE });
    expect(onScreen(placement, landscape, 600)).toBe(true);
  });
});
