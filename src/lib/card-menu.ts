/**
 * Where a card's dropdown (`CardMenuButton` in `src/ui/CardActions.tsx`) sits on a phone, where it
 * opens over the whole screen so a tap anywhere outside it closes it.
 */

/** A phone's touch floor: every dropdown row is at least this tall there. */
export const CARD_MENU_ROW_MIN = 44;

/** The gap between the button and the dropdown under it. */
export const CARD_MENU_GAP = 6;

/** The room the dropdown leaves at the top and bottom of the screen, clear of the status bar, home indicator and navigation bar. */
export const CARD_MENU_EDGE = 44;

export type Box = { x: number; y: number; width: number; height: number };

/**
 * The dropdown's position in the window, from the button's frame in the window: under the button,
 * lined up with its right edge in a card's corner or its left edge under the header. When it would
 * run past the bottom of the screen it opens above the button instead, if there is more room there,
 * and it never starts above the top edge, so every row can be reached without scrolling.
 */
export function cardMenuPlacement(
  button: Box,
  window: { width: number; height: number },
  align: "left" | "right",
  menuHeight = 0,
): { top: number; left: number } | { top: number; right: number } {
  const below = button.y + button.height + CARD_MENU_GAP;
  const above = button.y - CARD_MENU_GAP - menuHeight;
  const fitsBelow = below + menuHeight <= window.height - CARD_MENU_EDGE;
  const roomBelow = window.height - CARD_MENU_EDGE - below;
  const roomAbove = button.y - CARD_MENU_GAP - CARD_MENU_EDGE;
  const top = fitsBelow || roomBelow >= roomAbove ? below : Math.max(CARD_MENU_EDGE, above);
  return align === "right" ? { top, right: Math.max(0, window.width - (button.x + button.width)) } : { top, left: Math.max(0, button.x) };
}
