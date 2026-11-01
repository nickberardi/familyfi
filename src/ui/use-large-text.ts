import { useWindowDimensions } from "react-native";

/** The text size, as a multiple of the default, from which pieces set side by side stack instead. */
export const STACK_AT = 1.35;

/** Whether the person's text size is large enough to stack side-by-side pieces. The web's is always the default. */
export function useLargeText(): boolean {
  return useWindowDimensions().fontScale >= STACK_AT;
}
