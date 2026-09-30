import { Icon } from "@/components/ui/Icon";

import type { UI } from "./UIContext";

/** The web's theme is its stylesheet: every colour is the page's own CSS variable. */
export const defaultUI: UI = {
  color: (token) => `var(--ff-${token})`,
  shadow: (name) => `var(--ff-${`shadow-${name}`})`,
  font: "var(--ff-font)",
  Icon,
};
