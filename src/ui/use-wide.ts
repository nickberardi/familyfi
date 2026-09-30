import { useWindowDimensions } from "react-native";

/** The web's `md` breakpoint (768 px): wider screens outline cards and set group names smaller. */
export function useWide(): boolean {
  return useWindowDimensions().width >= 768;
}
