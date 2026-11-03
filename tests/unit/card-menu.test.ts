import { describe, expect, it } from "vitest";

import { CARD_MENU_GAP, CARD_MENU_ROW_MIN, cardMenuPlacement } from "@/lib/card-menu";

describe("card dropdown on a phone", () => {
  it("keeps every row at the 44 pt touch floor", () => {
    expect(CARD_MENU_ROW_MIN).toBe(44);
  });

  it("hangs under the button, lined up with its outer edge", () => {
    const button = { x: 250, y: 120, width: 110, height: 32 };
    expect(cardMenuPlacement(button, { width: 390 }, "right")).toEqual({ top: 120 + 32 + CARD_MENU_GAP, right: 30 });
    expect(cardMenuPlacement(button, { width: 390 }, "left")).toEqual({ top: 158, left: 250 });
  });

  it("never places the dropdown off the screen's edge", () => {
    const wide = { x: -4, y: 0, width: 400, height: 32 };
    expect(cardMenuPlacement(wide, { width: 390 }, "right")).toEqual({ top: 38, right: 0 });
    expect(cardMenuPlacement(wide, { width: 390 }, "left")).toEqual({ top: 38, left: 0 });
  });
});
