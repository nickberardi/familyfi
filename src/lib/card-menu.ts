/**
 * Where a card's dropdown (`CardMenuButton` in `src/ui/CardActions.tsx`) sits on a phone, where it
 * opens over the whole screen so a tap anywhere outside it closes it.
 */

/** A phone's touch floor: every dropdown row is at least this tall there. */
export const CARD_MENU_ROW_MIN = 44;

/** The gap between the button and the dropdown under it. */
export const CARD_MENU_GAP = 6;

export type Box = { x: number; y: number; width: number; height: number };

/**
 * The dropdown's position in the window, from the button's frame in the window: under the button,
 * lined up with its right edge in a card's corner or its left edge under the header.
 */
export function cardMenuPlacement(
  button: Box,
  window: { width: number },
  align: "left" | "right",
): { top: number; left: number } | { top: number; right: number } {
  const top = button.y + button.height + CARD_MENU_GAP;
  return align === "right" ? { top, right: Math.max(0, window.width - (button.x + button.width)) } : { top, left: Math.max(0, button.x) };
}
