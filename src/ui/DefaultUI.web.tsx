import { TextField } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";

import type { UI } from "./UIContext";

/** The web's theme is its stylesheet: every colour is the page's own CSS variable. */
export const defaultUI: UI = {
  color: (token) => `var(--ff-${token})`,
  shadow: (name) => `var(--ff-${`shadow-${name}`})`,
  font: "var(--ff-font)",
  Icon,
  // The web's fields keep its own font, a URL's included.
  TextField: ({ label, value, onChange, placeholder, maxLength, onSubmit, disabled }) => (
    <TextField label={label} value={value} onChange={onChange} placeholder={placeholder} maxLength={maxLength} onSubmit={onSubmit} disabled={disabled} />
  ),
  Segmented: ({ name, value, segments, onChange }) => <Segmented name={name} grow value={value} onChange={onChange} segments={segments} />,
};
