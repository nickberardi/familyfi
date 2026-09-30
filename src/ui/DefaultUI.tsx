import type { UI } from "./UIContext";
import { paletteColor } from "./palette";

/** Native apps provide their appearance-aware palette and icons; this is only the fallback. */
export const defaultUI: UI = {
  color: (token) => paletteColor("light", token),
  Icon: () => null,
};
