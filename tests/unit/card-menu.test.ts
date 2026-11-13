import { describe, expect, it } from "vitest";

import { CARD_MENU_EDGE, CARD_MENU_GAP, CARD_MENU_INSET_GAP, CARD_MENU_ROW_MIN, CARD_MENU_SIDE, cardMenuPlacement } from "@/lib/card-menu";

const phone = { width: 390, height: 844 };
const landscape = { width: 844, height: 390 };
const maxHeight = phone.height - 2 * CARD_MENU_EDGE;
// Where a right-aligned dropdown 30 pt from the right edge may grow to.
const widths = { maxWidth: phone.width - 30 - CARD_MENU_SIDE, minWidth: 240 };

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
    expect(cardMenuPlacement(button, phone, "right")).toEqual({ top: 120 + 32 + CARD_MENU_GAP, right: 30, maxHeight, ...widths });
    expect(cardMenuPlacement(button, phone, "left")).toEqual({ top: 158, left: 250, maxHeight, maxWidth: phone.width - 250 - CARD_MENU_SIDE, minWidth: phone.width - 250 - CARD_MENU_SIDE });
  });

  it("never places the dropdown off the screen's side", () => {
    const wide = { x: -4, y: 100, width: 400, height: 32 };
    expect(cardMenuPlacement(wide, phone, "right")).toMatchObject({ right: 0 });
    expect(cardMenuPlacement(wide, phone, "left")).toMatchObject({ left: 0 });
  });

  it("opens above the button when it would run past the bottom of the screen", () => {
    const low = { x: 250, y: 700, width: 110, height: 32 };
    // Three 44 pt rows and their borders.
    expect(cardMenuPlacement(low, phone, "right", 134)).toEqual({ top: 700 - CARD_MENU_GAP - 134, right: 30, maxHeight, ...widths });
    // A short dropdown that still fits stays under the button.
    expect(cardMenuPlacement(low, phone, "right", 46)).toEqual({ top: 738, right: 30, maxHeight, ...widths });
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
    expect(placement).toMatchObject({ top: CARD_MENU_EDGE, left: 600, maxHeight: landscape.height - 2 * CARD_MENU_EDGE });
    expect(onScreen(placement, landscape, 600)).toBe(true);
  });

  it("keeps clear of system bars taller than its usual edge", () => {
    // An iPhone with a Dynamic Island (59 pt) and a home indicator (34 pt); a dropdown taller than the screen leaves room for.
    const insets = { top: 59, bottom: 34 };
    const low = { x: 250, y: 300, width: 110, height: 32 };
    const placement = cardMenuPlacement(low, phone, "right", 900, insets);
    expect(placement.top).toBe(59 + CARD_MENU_INSET_GAP);
    expect(placement.top + Math.min(900, placement.maxHeight)).toBeLessThanOrEqual(phone.height - CARD_MENU_EDGE);
    // Android's three-button navigation bar (48 dp) at the bottom.
    const tall = cardMenuPlacement({ x: 250, y: 100, width: 110, height: 32 }, phone, "right", 900, { top: 24, bottom: 48 });
    expect(tall.top + Math.min(900, tall.maxHeight)).toBe(phone.height - 48 - CARD_MENU_INSET_GAP);
  });

  it("wraps a long label on screen instead of running off the far edge", () => {
    const corner = cardMenuPlacement({ x: 250, y: 120, width: 110, height: 32 }, phone, "right");
    expect(corner).toMatchObject({ right: 30, maxWidth: 390 - 30 - CARD_MENU_SIDE });
    const header = cardMenuPlacement({ x: 72, y: 120, width: 110, height: 32 }, phone, "left");
    expect(header).toMatchObject({ left: 72, maxWidth: 390 - 72 - CARD_MENU_SIDE, minWidth: 240 });
    // A narrow screen: the least width gives way so the dropdown still ends on screen.
    const narrow = cardMenuPlacement({ x: 200, y: 120, width: 110, height: 32 }, { width: 320, height: 568 }, "left");
    expect(narrow).toMatchObject({ maxWidth: 104, minWidth: 104 });
  });
});
