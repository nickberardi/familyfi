"use client";

import { useServerInsertedHTML } from "next/navigation";
import type { ReactNode } from "react";
import { StyleSheet } from "react-native";

/**
 * Shared components (`src/ui`) render through react-native-web, which writes their styles to a
 * stylesheet at runtime. This puts that stylesheet in the server-rendered HTML too, so a page
 * arrives styled rather than flashing unstyled until hydration.
 */
export function ReactNativeWebStyles({ children }: { children: ReactNode }) {
  useServerInsertedHTML(() => {
    const sheet = (StyleSheet as unknown as { getSheet: () => { id: string; textContent: string } }).getSheet();
    return <style id={sheet.id} dangerouslySetInnerHTML={{ __html: sheet.textContent }} />;
  });
  return children;
}
