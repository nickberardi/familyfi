import type { UI } from "./UIContext";
import { SHADOWS, paletteColor } from "./palette";

/** Native apps provide their appearance-aware palette and icons; this is only the fallback. */
export const defaultUI: UI = {
  color: (token) => paletteColor("light", token),
  shadow: (name) => SHADOWS[name],
  Icon: () => null,
  TextField: () => null,
  Segmented: () => null,
  Toggle: () => null,
  TimeField: () => null,
  DayPicker: () => null,
  Select: () => null,
  Link: ({ children }) => children,
  confirm: () => Promise.resolve(false),
};
