/**
 * Where a card's dropdown (`CardMenuButton` in `src/ui/CardActions.tsx`) sits on a phone, where it
 * opens over the whole screen so a tap anywhere outside it closes it.
 */

/** A phone's touch floor: every dropdown row is at least this tall there. */
export const CARD_MENU_ROW_MIN = 44;

/** The gap between the button and the dropdown under it. */
export const CARD_MENU_GAP = 6;

/**
 * The least room the dropdown leaves at the top and bottom of the screen. Where the system bars
 * (a Dynamic Island, a navigation bar) take more, it keeps `CARD_MENU_INSET_GAP` clear of them.
 */
export const CARD_MENU_EDGE = 44;

/** The room the dropdown keeps beyond the system bars' insets. */
export const CARD_MENU_INSET_GAP = 8;

/** The room the dropdown leaves at the side of the screen it grows towards, so a long label wraps on screen. */
export const CARD_MENU_SIDE = 16;

/** Its usual least width; on a screen too narrow for it, it takes the room it has. */
export const CARD_MENU_MIN_WIDTH = 240;

export type Box = { x: number; y: number; width: number; height: number };

/** The system bars' insets, as the platform reports them. */
export type Insets = { top: number; bottom: number };

/**
 * The dropdown's position in the window, from the button's frame in the window: under the button,
 * lined up with its right edge in a card's corner or its left edge under the header. When it would
 * run past the bottom of the screen it opens above the button instead, if there is more room there.
 * Either way it stays clear of the top and bottom of the screen and the system bars there, and
 * `maxHeight` is the most it may take, so a dropdown taller than that scrolls rather than leaving
 * rows out of reach. `maxWidth` keeps it on screen on the side it grows towards, so a long label
 * wraps instead of running off the edge.
 */
export function cardMenuPlacement(
  button: Box,
  window: { width: number; height: number },
  align: "left" | "right",
  menuHeight = 0,
  insets: Insets = { top: 0, bottom: 0 },
): ({ top: number; left: number } | { top: number; right: number }) & { maxHeight: number; maxWidth: number; minWidth: number } {
  const edgeTop = Math.max(CARD_MENU_EDGE, insets.top + CARD_MENU_INSET_GAP);
  const edgeBottom = Math.max(CARD_MENU_EDGE, insets.bottom + CARD_MENU_INSET_GAP);
  const maxHeight = Math.max(0, window.height - edgeTop - edgeBottom);
  const height = Math.min(menuHeight, maxHeight);
  const below = button.y + button.height + CARD_MENU_GAP;
  const above = button.y - CARD_MENU_GAP - height;
  const fitsBelow = below + height <= window.height - edgeBottom;
  const roomBelow = window.height - edgeBottom - below;
  const roomAbove = button.y - CARD_MENU_GAP - edgeTop;
  const preferred = fitsBelow || roomBelow >= roomAbove ? below : above;
  const top = Math.max(edgeTop, Math.min(preferred, window.height - edgeBottom - height));
  const right = Math.max(0, window.width - (button.x + button.width));
  const left = Math.max(0, button.x);
  const maxWidth = Math.max(0, window.width - (align === "right" ? right : left) - CARD_MENU_SIDE);
  const minWidth = Math.min(CARD_MENU_MIN_WIDTH, maxWidth);
  return align === "right" ? { top, right, maxHeight, maxWidth, minWidth } : { top, left, maxHeight, maxWidth, minWidth };
}
